import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@sts2/shared/types/database.types";

export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
