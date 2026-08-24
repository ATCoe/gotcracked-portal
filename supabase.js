const SUPABASE_URL = "https://uvpmmbioerejeyybfntb.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_CmcUD2ze8lhj4HvlMfoYiQ_DGG_xabb";


window.supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);
