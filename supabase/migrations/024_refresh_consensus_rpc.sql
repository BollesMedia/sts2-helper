create or replace function refresh_community_tier_consensus()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view concurrently community_tier_consensus;
end;
$$;

revoke all on function refresh_community_tier_consensus() from public;
