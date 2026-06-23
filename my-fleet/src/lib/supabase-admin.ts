import { createClient } from "@supabase/supabase-js";

const DEV_REF = "zhdqdxtwipcowbtdyviq";
const PROD_REF = "tcykyktvdlsbscrsbjyt";

function assertDevOnly(url: string) {
  if (url.includes(PROD_REF)) {
    throw new Error("Refusing admin client: production Supabase detected.");
  }
  if (!url.includes(DEV_REF)) {
    throw new Error(`Refusing admin client: expected dev branch ${DEV_REF}.`);
  }
}

/** Server-only Supabase client (service role). Never import in client components. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  assertDevOnly(url);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
