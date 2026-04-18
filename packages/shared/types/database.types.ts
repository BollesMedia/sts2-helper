export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      act_paths: {
        Row: {
          id: string
          run_id: string
          act: number
          recommended_path: Json
          actual_path: Json
          node_preferences: Json | null
          deviation_count: number
          deviation_nodes: Json
          context_at_start: Json | null
          user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          act: number
          recommended_path?: Json
          actual_path?: Json
          node_preferences?: Json | null
          deviation_count?: number
          deviation_nodes?: Json
          context_at_start?: Json | null
          user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          run_id?: string
          act?: number
          recommended_path?: Json
          actual_path?: Json
          node_preferences?: Json | null
          deviation_count?: number
          deviation_nodes?: Json
          context_at_start?: Json | null
          user_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "act_paths_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      cards: {
        Row: {
          block: number | null
          color: string
          cost: number | null
          damage: number | null
          description: string
          description_raw: string | null
          game_version: string | null
          hit_count: number | null
          id: string
          image_url: string | null
          keywords: string[] | null
          name: string
          rarity: string
          star_cost: number | null
          tags: string[] | null
          target: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          block?: number | null
          color: string
          cost?: number | null
          damage?: number | null
          description: string
          description_raw?: string | null
          game_version?: string | null
          hit_count?: number | null
          id: string
          image_url?: string | null
          keywords?: string[] | null
          name: string
          rarity: string
          star_cost?: number | null
          tags?: string[] | null
          target?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          block?: number | null
          color?: string
          cost?: number | null
          damage?: number | null
          description?: string
          description_raw?: string | null
          game_version?: string | null
          hit_count?: number | null
          id?: string
          image_url?: string | null
          keywords?: string[] | null
          name?: string
          rarity?: string
          star_cost?: number | null
          tags?: string[] | null
          target?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cards_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      character_strategies: {
        Row: {
          display_name: string
          id: string
          strategy: string
          updated_at: string | null
        }
        Insert: {
          display_name: string
          id: string
          strategy: string
          updated_at?: string | null
        }
        Update: {
          display_name?: string
          id?: string
          strategy?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      characters: {
        Row: {
          color: string | null
          description: string | null
          game_version: string | null
          gender: string | null
          id: string
          image_url: string | null
          name: string
          orb_slots: number | null
          starting_deck: string[] | null
          starting_energy: number
          starting_gold: number
          starting_hp: number
          starting_relics: string[] | null
          unlocks_after: string | null
        }
        Insert: {
          color?: string | null
          description?: string | null
          game_version?: string | null
          gender?: string | null
          id: string
          image_url?: string | null
          name: string
          orb_slots?: number | null
          starting_deck?: string[] | null
          starting_energy: number
          starting_gold: number
          starting_hp: number
          starting_relics?: string[] | null
          unlocks_after?: string | null
        }
        Update: {
          color?: string | null
          description?: string | null
          game_version?: string | null
          gender?: string | null
          id?: string
          image_url?: string | null
          name?: string
          orb_slots?: number | null
          starting_deck?: string[] | null
          starting_energy?: number
          starting_gold?: number
          starting_hp?: number
          starting_relics?: string[] | null
          unlocks_after?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "characters_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      choices: {
        Row: {
          act: number
          choice_type: string
          chosen_item_id: string | null
          created_at: string | null
          eval_pending: boolean
          evaluation_ids: string[] | null
          floor: number
          game_context: Json | null
          id: string
          offered_item_ids: string[]
          rankings_snapshot: Json | null
          recommended_item_id: string | null
          recommended_tier: string | null
          run_id: string | null
          run_state_snapshot: Json | null
          sequence: number
          user_id: string | null
          was_followed: boolean | null
        }
        Insert: {
          act: number
          choice_type: string
          chosen_item_id?: string | null
          created_at?: string | null
          eval_pending?: boolean
          evaluation_ids?: string[] | null
          floor: number
          game_context?: Json | null
          id?: string
          offered_item_ids: string[]
          rankings_snapshot?: Json | null
          recommended_item_id?: string | null
          recommended_tier?: string | null
          run_id?: string | null
          run_state_snapshot?: Json | null
          sequence?: number
          user_id?: string | null
          was_followed?: boolean | null
        }
        Update: {
          act?: number
          choice_type?: string
          chosen_item_id?: string | null
          created_at?: string | null
          eval_pending?: boolean
          evaluation_ids?: string[] | null
          floor?: number
          game_context?: Json | null
          id?: string
          offered_item_ids?: string[]
          rankings_snapshot?: Json | null
          recommended_item_id?: string | null
          recommended_tier?: string | null
          run_id?: string | null
          run_state_snapshot?: Json | null
          sequence?: number
          user_id?: string | null
          was_followed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "choices_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      error_logs: {
        Row: {
          app_version: string | null
          context: Json | null
          created_at: string | null
          id: string
          level: string | null
          message: string
          platform: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          context?: Json | null
          created_at?: string | null
          id?: string
          level?: string | null
          message: string
          platform?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          context?: Json | null
          created_at?: string | null
          id?: string
          level?: string | null
          message?: string
          platform?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      evaluations: {
        Row: {
          act: number
          archetypes: string[] | null
          ascension: number | null
          character: string
          confidence: number
          context_hash: string
          created_at: string | null
          curse_count: number | null
          deck_size: number
          energy: number | null
          eval_type: string | null
          floor: number
          game_version: string | null
          gold: number | null
          has_scaling: boolean | null
          hp_percent: number
          id: string
          item_id: string
          item_name: string
          item_type: string
          original_tier_value: number | null
          primary_archetype: string | null
          reasoning: string
          recommendation: string
          relic_ids: string[] | null
          run_id: string | null
          source: string
          synergy_score: number
          tier_value: number
          user_id: string | null
          weight_adjustments: Json | null
        }
        Insert: {
          act: number
          archetypes?: string[] | null
          ascension?: number | null
          character: string
          confidence: number
          context_hash: string
          created_at?: string | null
          curse_count?: number | null
          deck_size: number
          energy?: number | null
          eval_type?: string | null
          floor: number
          game_version?: string | null
          gold?: number | null
          has_scaling?: boolean | null
          hp_percent: number
          id?: string
          item_id: string
          item_name: string
          item_type: string
          original_tier_value?: number | null
          primary_archetype?: string | null
          reasoning: string
          recommendation: string
          relic_ids?: string[] | null
          run_id?: string | null
          source?: string
          synergy_score: number
          tier_value: number
          user_id?: string | null
          weight_adjustments?: Json | null
        }
        Update: {
          act?: number
          archetypes?: string[] | null
          ascension?: number | null
          character?: string
          confidence?: number
          context_hash?: string
          created_at?: string | null
          curse_count?: number | null
          deck_size?: number
          energy?: number | null
          eval_type?: string | null
          floor?: number
          game_version?: string | null
          gold?: number | null
          has_scaling?: boolean | null
          hp_percent?: number
          id?: string
          item_id?: string
          item_name?: string
          item_type?: string
          original_tier_value?: number | null
          primary_archetype?: string | null
          reasoning?: string
          recommendation?: string
          relic_ids?: string[] | null
          run_id?: string | null
          source?: string
          synergy_score?: number
          tier_value?: number
          user_id?: string | null
          weight_adjustments?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      game_versions: {
        Row: {
          id: string
          is_major_balance_patch: boolean
          notes_url: string | null
          release_notes: string | null
          released_at: string | null
          synced_at: string | null
          version: string
        }
        Insert: {
          id?: string
          is_major_balance_patch?: boolean
          notes_url?: string | null
          release_notes?: string | null
          released_at?: string | null
          synced_at?: string | null
          version: string
        }
        Update: {
          id?: string
          is_major_balance_patch?: boolean
          notes_url?: string | null
          release_notes?: string | null
          released_at?: string | null
          synced_at?: string | null
          version?: string
        }
        Relationships: []
      }
      keywords: {
        Row: {
          description: string
          game_version: string | null
          id: string
          name: string
        }
        Insert: {
          description: string
          game_version?: string | null
          id: string
          name: string
        }
        Update: {
          description?: string
          game_version?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "keywords_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      monsters: {
        Row: {
          game_version: string | null
          id: string
          image_url: string | null
          max_hp: number | null
          min_hp: number | null
          moves: Json | null
          name: string
          type: string
          updated_at: string | null
        }
        Insert: {
          game_version?: string | null
          id: string
          image_url?: string | null
          max_hp?: number | null
          min_hp?: number | null
          moves?: Json | null
          name: string
          type: string
          updated_at?: string | null
        }
        Update: {
          game_version?: string | null
          id?: string
          image_url?: string | null
          max_hp?: number | null
          min_hp?: number | null
          moves?: Json | null
          name?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monsters_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      potions: {
        Row: {
          description: string
          game_version: string | null
          id: string
          image_url: string | null
          name: string
          pool: string | null
          rarity: string | null
          updated_at: string | null
        }
        Insert: {
          description: string
          game_version?: string | null
          id: string
          image_url?: string | null
          name: string
          pool?: string | null
          rarity?: string | null
          updated_at?: string | null
        }
        Update: {
          description?: string
          game_version?: string | null
          id?: string
          image_url?: string | null
          name?: string
          pool?: string | null
          rarity?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "potions_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      relics: {
        Row: {
          description: string
          game_version: string | null
          id: string
          image_url: string | null
          name: string
          pool: string | null
          rarity: string | null
          updated_at: string | null
        }
        Insert: {
          description: string
          game_version?: string | null
          id: string
          image_url?: string | null
          name: string
          pool?: string | null
          rarity?: string | null
          updated_at?: string | null
        }
        Update: {
          description?: string
          game_version?: string | null
          id?: string
          image_url?: string | null
          name?: string
          pool?: string | null
          rarity?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "relics_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      runs: {
        Row: {
          act_reached: number | null
          ascension_level: number | null
          bosses_fought: string[] | null
          cause_of_death: string | null
          character: string
          ended_at: string | null
          final_deck: string[] | null
          final_deck_size: number | null
          final_floor: number | null
          final_relics: string[] | null
          game_mode: string
          game_version: string | null
          id: string
          narrative: Json | null
          notes: string | null
          run_id: string
          started_at: string | null
          user_id: string | null
          victory: boolean | null
        }
        Insert: {
          act_reached?: number | null
          ascension_level?: number | null
          bosses_fought?: string[] | null
          cause_of_death?: string | null
          character: string
          ended_at?: string | null
          final_deck?: string[] | null
          final_deck_size?: number | null
          final_floor?: number | null
          final_relics?: string[] | null
          game_mode?: string
          game_version?: string | null
          id?: string
          narrative?: Json | null
          notes?: string | null
          run_id: string
          started_at?: string | null
          user_id?: string | null
          victory?: boolean | null
        }
        Update: {
          act_reached?: number | null
          ascension_level?: number | null
          bosses_fought?: string[] | null
          cause_of_death?: string | null
          character?: string
          ended_at?: string | null
          final_deck?: string[] | null
          final_deck_size?: number | null
          final_floor?: number | null
          final_relics?: string[] | null
          game_mode?: string
          game_version?: string | null
          id?: string
          narrative?: Json | null
          notes?: string | null
          run_id?: string
          started_at?: string | null
          user_id?: string | null
          victory?: boolean | null
        }
        Relationships: []
      }
      usage_logs: {
        Row: {
          cost_estimate: number | null
          created_at: string | null
          eval_type: string
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          user_id: string | null
        }
        Insert: {
          cost_estimate?: number | null
          created_at?: string | null
          eval_type: string
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          cost_estimate?: number | null
          created_at?: string | null
          eval_type?: string
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      weight_rules: {
        Row: {
          action: Json
          condition: Json
          created_at: string | null
          enabled: boolean | null
          eval_type: string
          id: string
          priority: number | null
          sample_size: number | null
          source: string | null
          win_rate_delta: number | null
        }
        Insert: {
          action: Json
          condition: Json
          created_at?: string | null
          enabled?: boolean | null
          eval_type: string
          id: string
          priority?: number | null
          sample_size?: number | null
          source?: string | null
          win_rate_delta?: number | null
        }
        Update: {
          action?: Json
          condition?: Json
          created_at?: string | null
          enabled?: boolean | null
          eval_type?: string
          id?: string
          priority?: number | null
          sample_size?: number | null
          source?: string | null
          win_rate_delta?: number | null
        }
        Relationships: []
      }
      tier_list_entries: {
        Row: {
          card_id: string
          created_at: string
          extraction_confidence: number | null
          id: string
          normalized_tier: number
          note: string | null
          raw_tier: string
          tier_list_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          extraction_confidence?: number | null
          id?: string
          normalized_tier: number
          note?: string | null
          raw_tier: string
          tier_list_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          extraction_confidence?: number | null
          id?: string
          normalized_tier?: number
          note?: string | null
          raw_tier?: string
          tier_list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_list_entries_tier_list_id_fkey"
            columns: ["tier_list_id"]
            isOneToOne: false
            referencedRelation: "tier_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_list_entries_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_list_sources: {
        Row: {
          author: string
          created_at: string
          id: string
          notes: string | null
          scale_config: Json | null
          scale_type: string
          source_type: string
          source_url: string | null
          trust_weight: number
          updated_at: string
        }
        Insert: {
          author: string
          created_at?: string
          id: string
          notes?: string | null
          scale_config?: Json | null
          scale_type: string
          source_type: string
          source_url?: string | null
          trust_weight?: number
          updated_at?: string
        }
        Update: {
          author?: string
          created_at?: string
          id?: string
          notes?: string | null
          scale_config?: Json | null
          scale_type?: string
          source_type?: string
          source_url?: string | null
          trust_weight?: number
          updated_at?: string
        }
        Relationships: []
      }
      tier_lists: {
        Row: {
          character: string | null
          entry_count: number
          game_version: string | null
          id: string
          ingested_at: string
          ingestion_method: string
          is_active: boolean
          published_at: string
          source_id: string
          source_image_url: string | null
        }
        Insert: {
          character?: string | null
          entry_count?: number
          game_version?: string | null
          id?: string
          ingested_at?: string
          ingestion_method: string
          is_active?: boolean
          published_at: string
          source_id: string
          source_image_url?: string | null
        }
        Update: {
          character?: string | null
          entry_count?: number
          game_version?: string | null
          id?: string
          ingested_at?: string
          ingestion_method?: string
          is_active?: boolean
          published_at?: string
          source_id?: string
          source_image_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tier_lists_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "tier_list_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_lists_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      afflictions: {
        Row: {
          description: string
          extra_card_text: string | null
          game_version: string | null
          id: string
          is_stackable: boolean
          name: string
          updated_at: string | null
        }
        Insert: {
          description: string
          extra_card_text?: string | null
          game_version?: string | null
          id: string
          is_stackable?: boolean
          name: string
          updated_at?: string | null
        }
        Update: {
          description?: string
          extra_card_text?: string | null
          game_version?: string | null
          id?: string
          is_stackable?: boolean
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "afflictions_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      enchantments: {
        Row: {
          applicable_to: string | null
          card_type: string | null
          description: string
          description_raw: string | null
          extra_card_text: string | null
          game_version: string | null
          id: string
          image_url: string | null
          is_stackable: boolean
          name: string
          updated_at: string | null
        }
        Insert: {
          applicable_to?: string | null
          card_type?: string | null
          description: string
          description_raw?: string | null
          extra_card_text?: string | null
          game_version?: string | null
          id: string
          image_url?: string | null
          is_stackable?: boolean
          name: string
          updated_at?: string | null
        }
        Update: {
          applicable_to?: string | null
          card_type?: string | null
          description?: string
          description_raw?: string | null
          extra_card_text?: string | null
          game_version?: string | null
          id?: string
          image_url?: string | null
          is_stackable?: boolean
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enchantments_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      encounters: {
        Row: {
          act: string | null
          game_version: string | null
          id: string
          is_weak: boolean
          loss_text: string | null
          monsters: Json | null
          name: string
          room_type: string
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          act?: string | null
          game_version?: string | null
          id: string
          is_weak?: boolean
          loss_text?: string | null
          monsters?: Json | null
          name: string
          room_type: string
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          act?: string | null
          game_version?: string | null
          id?: string
          is_weak?: boolean
          loss_text?: string | null
          monsters?: Json | null
          name?: string
          room_type?: string
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "encounters_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      events: {
        Row: {
          act: string | null
          description: string | null
          dialogue: Json | null
          epithet: string | null
          game_version: string | null
          id: string
          image_url: string | null
          name: string
          options: Json | null
          pages: Json | null
          preconditions: Json | null
          relics: string[] | null
          type: string
          updated_at: string | null
        }
        Insert: {
          act?: string | null
          description?: string | null
          dialogue?: Json | null
          epithet?: string | null
          game_version?: string | null
          id: string
          image_url?: string | null
          name: string
          options?: Json | null
          pages?: Json | null
          preconditions?: Json | null
          relics?: string[] | null
          type: string
          updated_at?: string | null
        }
        Update: {
          act?: string | null
          description?: string | null
          dialogue?: Json | null
          epithet?: string | null
          game_version?: string | null
          id?: string
          image_url?: string | null
          name?: string
          options?: Json | null
          pages?: Json | null
          preconditions?: Json | null
          relics?: string[] | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      orbs: {
        Row: {
          description: string
          description_raw: string | null
          game_version: string | null
          id: string
          image_url: string | null
          name: string
          updated_at: string | null
        }
        Insert: {
          description: string
          description_raw?: string | null
          game_version?: string | null
          id: string
          image_url?: string | null
          name: string
          updated_at?: string | null
        }
        Update: {
          description?: string
          description_raw?: string | null
          game_version?: string | null
          id?: string
          image_url?: string | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orbs_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      powers: {
        Row: {
          allow_negative: boolean | null
          description: string
          description_raw: string | null
          game_version: string | null
          id: string
          image_url: string | null
          name: string
          stack_type: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          allow_negative?: boolean | null
          description: string
          description_raw?: string | null
          game_version?: string | null
          id: string
          image_url?: string | null
          name: string
          stack_type?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          allow_negative?: boolean | null
          description?: string
          description_raw?: string | null
          game_version?: string | null
          id?: string
          image_url?: string | null
          name?: string
          stack_type?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "powers_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
    }
    Views: {
      community_tier_consensus: {
        Row: {
          card_id: string | null
          character_scope: string | null
          game_versions: string[] | null
          most_recent_published: string | null
          oldest_published: string | null
          source_count: number | null
          tier_stddev: number | null
          weighted_tier: number | null
        }
        Relationships: []
      }
      card_win_rates: {
        Row: {
          act: number | null
          ascension_tier: string | null
          character: string | null
          item_id: string | null
          item_name: string | null
          pick_win_rate: number | null
          primary_archetype: string | null
          skip_win_rate: number | null
          times_offered: number | null
          times_picked: number | null
          times_skipped: number | null
        }
        Relationships: []
      }
      eval_accuracy: {
        Row: {
          avg_confidence: number | null
          eval_type: string | null
          n: number | null
          player_action: string | null
          predicted_rec: string | null
          predicted_tier: number | null
          source: string | null
          victory: boolean | null
        }
        Relationships: []
      }
      evaluation_stats: {
        Row: {
          act: number | null
          avg_confidence: number | null
          character: string | null
          eval_count: number | null
          item_id: string | null
          item_name: string | null
          most_common_rec: string | null
          primary_archetype: string | null
          tier_stddev: number | null
          weighted_synergy: number | null
          weighted_tier: number | null
        }
        Relationships: []
      }
      evaluation_stats_v2: {
        Row: {
          act: number | null
          ascension_tier: string | null
          avg_confidence: number | null
          character: string | null
          eval_count: number | null
          item_id: string | null
          item_name: string | null
          most_common_rec: string | null
          primary_archetype: string | null
          tier_stddev: number | null
          weighted_synergy: number | null
          weighted_tier: number | null
        }
        Relationships: []
      }
      recommendation_follow_rates: {
        Row: {
          ascension_tier: string | null
          character: string | null
          choice_type: string | null
          diverged: number | null
          diverged_win_rate: number | null
          follow_rate: number | null
          followed: number | null
          followed_win_rate: number | null
          total_choices: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
