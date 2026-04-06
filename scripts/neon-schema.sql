--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, role) values (new.id, 'user');
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: act_paths; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.act_paths (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id text NOT NULL,
    act integer NOT NULL,
    recommended_path jsonb DEFAULT '[]'::jsonb NOT NULL,
    actual_path jsonb DEFAULT '[]'::jsonb NOT NULL,
    node_preferences jsonb,
    deviation_count integer DEFAULT 0 NOT NULL,
    deviation_nodes jsonb DEFAULT '[]'::jsonb NOT NULL,
    context_at_start jsonb,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: choices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.choices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    run_id text,
    choice_type text NOT NULL,
    floor integer NOT NULL,
    act integer NOT NULL,
    offered_item_ids text[] NOT NULL,
    chosen_item_id text,
    evaluation_ids uuid[],
    user_id uuid,
    recommended_item_id text,
    recommended_tier text,
    was_followed boolean,
    rankings_snapshot jsonb,
    game_context jsonb,
    eval_pending boolean DEFAULT false NOT NULL,
    sequence smallint DEFAULT 0 NOT NULL
);


--
-- Name: evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    run_id text,
    game_version text,
    item_type text NOT NULL,
    item_id text NOT NULL,
    item_name text NOT NULL,
    "character" text NOT NULL,
    archetypes text[],
    primary_archetype text,
    act integer NOT NULL,
    floor integer NOT NULL,
    deck_size integer NOT NULL,
    hp_percent double precision NOT NULL,
    gold integer,
    energy integer,
    relic_ids text[],
    has_scaling boolean,
    curse_count integer DEFAULT 0,
    tier_value integer NOT NULL,
    synergy_score integer NOT NULL,
    confidence integer NOT NULL,
    recommendation text NOT NULL,
    reasoning text NOT NULL,
    source text DEFAULT 'claude'::text NOT NULL,
    context_hash text NOT NULL,
    user_id uuid,
    ascension integer,
    eval_type text,
    original_tier_value integer,
    weight_adjustments jsonb
);


--
-- Name: runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id text NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone,
    "character" text NOT NULL,
    final_floor integer,
    victory boolean,
    ascension_level integer,
    game_version text,
    game_mode text DEFAULT 'singleplayer'::text NOT NULL,
    notes text,
    bosses_fought text[],
    final_deck text[],
    final_relics text[],
    final_deck_size integer,
    act_reached integer,
    cause_of_death text,
    user_id uuid,
    narrative jsonb
);


--
-- Name: card_win_rates; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.card_win_rates AS
 SELECT e.item_id,
    e.item_name,
    e."character",
    e.act,
    e.primary_archetype,
    COALESCE(
        CASE
            WHEN (r.ascension_level <= 4) THEN 'low'::text
            WHEN (r.ascension_level <= 9) THEN 'mid'::text
            ELSE 'high'::text
        END, 'low'::text) AS ascension_tier,
    count(*) AS times_offered,
    count(*) FILTER (WHERE (c.chosen_item_id IS NOT NULL)) AS times_picked,
    count(*) FILTER (WHERE (c.chosen_item_id IS NULL)) AS times_skipped,
    avg(
        CASE
            WHEN (r.victory AND (c.chosen_item_id IS NOT NULL)) THEN 1.0
            WHEN ((NOT r.victory) AND (c.chosen_item_id IS NOT NULL)) THEN 0.0
            ELSE NULL::numeric
        END) AS pick_win_rate,
    avg(
        CASE
            WHEN (r.victory AND (c.chosen_item_id IS NULL)) THEN 1.0
            WHEN ((NOT r.victory) AND (c.chosen_item_id IS NULL)) THEN 0.0
            ELSE NULL::numeric
        END) AS skip_win_rate
   FROM ((public.evaluations e
     JOIN public.choices c ON (((c.run_id = e.run_id) AND (c.floor = e.floor))))
     JOIN public.runs r ON (((r.run_id = e.run_id) AND (r.ended_at IS NOT NULL) AND (r.victory IS NOT NULL))))
  GROUP BY e.item_id, e.item_name, e."character", e.act, e.primary_archetype, COALESCE(
        CASE
            WHEN (r.ascension_level <= 4) THEN 'low'::text
            WHEN (r.ascension_level <= 9) THEN 'mid'::text
            ELSE 'high'::text
        END, 'low'::text)
  WITH NO DATA;


--
-- Name: cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cards (
    id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    description_raw text,
    cost integer,
    star_cost integer,
    type text NOT NULL,
    rarity text NOT NULL,
    color text NOT NULL,
    target text,
    damage integer,
    block integer,
    hit_count integer,
    keywords text[],
    tags text[],
    image_url text,
    game_version text,
    updated_at timestamp with time zone DEFAULT now(),
    upgrade jsonb,
    upgrade_description text
);


--
-- Name: character_strategies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_strategies (
    id text NOT NULL,
    display_name text NOT NULL,
    strategy text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters (
    id text NOT NULL,
    name text NOT NULL,
    starting_hp integer NOT NULL,
    starting_gold integer NOT NULL,
    starting_energy integer NOT NULL,
    starting_deck text[],
    starting_relics text[],
    game_version text
);


--
-- Name: error_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    source text NOT NULL,
    level text DEFAULT 'error'::text,
    message text NOT NULL,
    context jsonb,
    app_version text,
    platform text
);


--
-- Name: eval_accuracy; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.eval_accuracy AS
 SELECT e.source,
    e.eval_type,
    e.tier_value AS predicted_tier,
    e.recommendation AS predicted_rec,
        CASE
            WHEN (c.chosen_item_id = e.item_name) THEN 'picked'::text
            ELSE 'skipped'::text
        END AS player_action,
    r.victory,
    count(*) AS n,
    avg(e.confidence) AS avg_confidence
   FROM ((public.evaluations e
     JOIN public.choices c ON (((c.run_id = e.run_id) AND (c.floor = e.floor))))
     JOIN public.runs r ON (((r.run_id = e.run_id) AND (r.ended_at IS NOT NULL) AND (r.victory IS NOT NULL))))
  WHERE (e.eval_type IS NOT NULL)
  GROUP BY e.source, e.eval_type, e.tier_value, e.recommendation,
        CASE
            WHEN (c.chosen_item_id = e.item_name) THEN 'picked'::text
            ELSE 'skipped'::text
        END, r.victory
  WITH NO DATA;


--
-- Name: evaluation_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.evaluation_stats AS
 SELECT item_id,
    item_name,
    "character",
    primary_archetype,
    act,
    count(*) AS eval_count,
    (avg(confidence))::integer AS avg_confidence,
    round(((sum((tier_value * confidence)))::numeric / (NULLIF(sum(confidence), 0))::numeric), 1) AS weighted_tier,
    (round(((sum((synergy_score * confidence)))::numeric / (NULLIF(sum(confidence), 0))::numeric)))::integer AS weighted_synergy,
    mode() WITHIN GROUP (ORDER BY recommendation) AS most_common_rec,
    (stddev(tier_value))::numeric(3,1) AS tier_stddev
   FROM public.evaluations
  WHERE (source = 'claude'::text)
  GROUP BY item_id, item_name, "character", primary_archetype, act;


--
-- Name: evaluation_stats_v2; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.evaluation_stats_v2 AS
 SELECT e.item_id,
    e.item_name,
    e."character",
    e.primary_archetype,
    e.act,
    COALESCE(
        CASE
            WHEN (e.ascension <= 4) THEN 'low'::text
            WHEN (e.ascension <= 9) THEN 'mid'::text
            ELSE 'high'::text
        END, 'low'::text) AS ascension_tier,
    count(*) AS eval_count,
    (avg(e.confidence))::integer AS avg_confidence,
    round(((sum((e.tier_value * e.confidence)))::numeric / (NULLIF(sum(e.confidence), 0))::numeric), 1) AS weighted_tier,
    (round(((sum((e.synergy_score * e.confidence)))::numeric / (NULLIF(sum(e.confidence), 0))::numeric)))::integer AS weighted_synergy,
    mode() WITHIN GROUP (ORDER BY e.recommendation) AS most_common_rec,
    (stddev(e.tier_value))::numeric(3,1) AS tier_stddev
   FROM (public.evaluations e
     JOIN public.runs r ON ((r.run_id = e.run_id)))
  WHERE (e.source = 'claude'::text)
  GROUP BY e.item_id, e.item_name, e."character", e.primary_archetype, e.act, COALESCE(
        CASE
            WHEN (e.ascension <= 4) THEN 'low'::text
            WHEN (e.ascension <= 9) THEN 'mid'::text
            ELSE 'high'::text
        END, 'low'::text)
  WITH NO DATA;


--
-- Name: game_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version text NOT NULL,
    synced_at timestamp with time zone DEFAULT now()
);


--
-- Name: keywords; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.keywords (
    id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    game_version text
);


--
-- Name: monsters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monsters (
    id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    min_hp integer,
    max_hp integer,
    moves jsonb,
    image_url text,
    game_version text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: potions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.potions (
    id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    rarity text,
    pool text,
    image_url text,
    game_version text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: recommendation_follow_rates; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.recommendation_follow_rates AS
 SELECT c.choice_type,
    r."character",
        CASE
            WHEN (r.ascension_level <= 4) THEN 'low'::text
            WHEN (r.ascension_level <= 10) THEN 'mid'::text
            ELSE 'high'::text
        END AS ascension_tier,
    count(*) FILTER (WHERE (c.was_followed = true)) AS followed,
    count(*) FILTER (WHERE (c.was_followed = false)) AS diverged,
    count(*) AS total,
    round(((count(*) FILTER (WHERE (c.was_followed = true)))::numeric / (NULLIF(count(*), 0))::numeric), 3) AS follow_rate
   FROM (public.choices c
     JOIN public.runs r ON ((c.run_id = r.run_id)))
  WHERE ((c.was_followed IS NOT NULL) AND (c.eval_pending = false))
  GROUP BY c.choice_type, r."character",
        CASE
            WHEN (r.ascension_level <= 4) THEN 'low'::text
            WHEN (r.ascension_level <= 10) THEN 'mid'::text
            ELSE 'high'::text
        END
  WITH NO DATA;


--
-- Name: relics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relics (
    id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    rarity text,
    pool text,
    image_url text,
    game_version text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: usage_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    eval_type text NOT NULL,
    model text NOT NULL,
    input_tokens integer,
    output_tokens integer,
    cost_estimate double precision
);


--
-- Name: weight_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weight_rules (
    id text NOT NULL,
    eval_type text NOT NULL,
    condition jsonb NOT NULL,
    action jsonb NOT NULL,
    priority integer DEFAULT 0,
    enabled boolean DEFAULT true,
    source text DEFAULT 'manual'::text,
    sample_size integer,
    win_rate_delta double precision,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: act_paths act_paths_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.act_paths
    ADD CONSTRAINT act_paths_pkey PRIMARY KEY (id);


--
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);


--
-- Name: character_strategies character_strategies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_strategies
    ADD CONSTRAINT character_strategies_pkey PRIMARY KEY (id);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: choices choices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.choices
    ADD CONSTRAINT choices_pkey PRIMARY KEY (id);


--
-- Name: error_logs error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);


--
-- Name: evaluations evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT evaluations_pkey PRIMARY KEY (id);


--
-- Name: game_versions game_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_versions
    ADD CONSTRAINT game_versions_pkey PRIMARY KEY (id);


--
-- Name: game_versions game_versions_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_versions
    ADD CONSTRAINT game_versions_version_key UNIQUE (version);


--
-- Name: keywords keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keywords
    ADD CONSTRAINT keywords_pkey PRIMARY KEY (id);


--
-- Name: monsters monsters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monsters
    ADD CONSTRAINT monsters_pkey PRIMARY KEY (id);


--
-- Name: potions potions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.potions
    ADD CONSTRAINT potions_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: relics relics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relics
    ADD CONSTRAINT relics_pkey PRIMARY KEY (id);


--
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (id);


--
-- Name: runs runs_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_run_id_key UNIQUE (run_id);


--
-- Name: act_paths uq_act_paths_run_act; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.act_paths
    ADD CONSTRAINT uq_act_paths_run_act UNIQUE (run_id, act);


--
-- Name: usage_logs usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_pkey PRIMARY KEY (id);


--
-- Name: weight_rules weight_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weight_rules
    ADD CONSTRAINT weight_rules_pkey PRIMARY KEY (id);


--
-- Name: idx_act_paths_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_act_paths_run ON public.act_paths USING btree (run_id);


--
-- Name: idx_choices_eval_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_choices_eval_pending ON public.choices USING btree (run_id, eval_pending) WHERE (eval_pending = true);


--
-- Name: idx_choices_followed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_choices_followed ON public.choices USING btree (was_followed) WHERE (was_followed IS NOT NULL);


--
-- Name: idx_choices_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_choices_run ON public.choices USING btree (run_id);


--
-- Name: idx_choices_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_choices_type ON public.choices USING btree (choice_type);


--
-- Name: idx_cwr_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cwr_lookup ON public.card_win_rates USING btree (item_id, "character", act, ascension_tier);


--
-- Name: idx_error_logs_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_source ON public.error_logs USING btree (source, created_at DESC);


--
-- Name: idx_error_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_user ON public.error_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_esv2_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_esv2_lookup ON public.evaluation_stats_v2 USING btree (item_id, "character", act, ascension_tier);


--
-- Name: idx_eval_ascension; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_ascension ON public.evaluations USING btree (item_id, "character", ascension, act);


--
-- Name: idx_eval_context; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_context ON public.evaluations USING btree (context_hash, item_id);


--
-- Name: idx_eval_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_item ON public.evaluations USING btree (item_id, "character");


--
-- Name: idx_eval_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_lookup ON public.evaluations USING btree (item_id, "character", primary_archetype, act);


--
-- Name: idx_eval_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_run ON public.evaluations USING btree (run_id);


--
-- Name: idx_eval_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_type ON public.evaluations USING btree (eval_type);


--
-- Name: idx_usage_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_type ON public.usage_logs USING btree (eval_type);


--
-- Name: idx_usage_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_user_date ON public.usage_logs USING btree (user_id, created_at);


--
-- Name: uq_choices_run_floor_type_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_choices_run_floor_type_seq ON public.choices USING btree (run_id, floor, choice_type, sequence);


--
-- Name: act_paths act_paths_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.act_paths
    ADD CONSTRAINT act_paths_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.runs(run_id) ON DELETE CASCADE;


--
-- Name: act_paths act_paths_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.act_paths


--
-- Name: cards cards_game_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_game_version_fkey FOREIGN KEY (game_version) REFERENCES public.game_versions(version);


--
-- Name: characters characters_game_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_game_version_fkey FOREIGN KEY (game_version) REFERENCES public.game_versions(version);


--
-- Name: choices choices_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.choices
    ADD CONSTRAINT choices_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.runs(run_id);


--
-- Name: choices choices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.choices


--
-- Name: evaluations evaluations_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT evaluations_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.runs(run_id);


--
-- Name: evaluations evaluations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluations


--
-- Name: keywords keywords_game_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.keywords
    ADD CONSTRAINT keywords_game_version_fkey FOREIGN KEY (game_version) REFERENCES public.game_versions(version);


--
-- Name: monsters monsters_game_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monsters
    ADD CONSTRAINT monsters_game_version_fkey FOREIGN KEY (game_version) REFERENCES public.game_versions(version);


--
-- Name: potions potions_game_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.potions
    ADD CONSTRAINT potions_game_version_fkey FOREIGN KEY (game_version) REFERENCES public.game_versions(version);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles


--
-- Name: relics relics_game_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relics
    ADD CONSTRAINT relics_game_version_fkey FOREIGN KEY (game_version) REFERENCES public.game_versions(version);


--
-- Name: runs runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs


--
-- Name: usage_logs usage_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_logs


--
-- Name: usage_logs Authenticated insert usage; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: act_paths Public read act_paths; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: cards Public read cards; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: characters Public read characters; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: choices Public read choices; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: evaluations Public read evaluations; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: game_versions Public read game_versions; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: keywords Public read keywords; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: monsters Public read monsters; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: potions Public read potions; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: relics Public read relics; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: runs Public read runs; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: character_strategies Public read strategies; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: usage_logs Public read usage; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: weight_rules Public read weight rules; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: act_paths Users can insert own act_paths; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: choices Users can insert own choices; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: evaluations Users can insert own evaluations; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: runs Users can insert own runs; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: profiles Users can read own profile; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: runs Users can update own runs; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: act_paths Users can view own act_paths; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: error_logs Users insert own errors; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: error_logs Users read own errors; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: act_paths; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: cards; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: character_strategies; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: characters; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: choices; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: error_logs; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: evaluations; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: game_versions; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: keywords; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: monsters; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: potions; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: relics; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: runs; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: usage_logs; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: weight_rules; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- PostgreSQL database dump complete
--


