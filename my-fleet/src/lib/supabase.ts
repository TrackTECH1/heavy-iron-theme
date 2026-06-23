import { createClient } from "@supabase/supabase-js";

const DEV_REF = "zhdqdxtwipcowbtdyviq";
const PROD_REF = "tcykyktvdlsbscrsbjyt";

function assertDevOnly(url: string) {
  if (url.includes(PROD_REF)) {
    throw new Error(
      "Refusing to connect: production Supabase detected. Use dev branch only.",
    );
  }
  if (!url.includes(DEV_REF)) {
    throw new Error(
      `Refusing to connect: expected dev branch ${DEV_REF}, got ${url}`,
    );
  }
}

export function createFleetClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  assertDevOnly(url);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
