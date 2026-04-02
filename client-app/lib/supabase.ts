import 'react-native-url-polyfill/auto'
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = "https://ibmrhxjjqapasiqqkizh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fHZs61NNAfDFD_f61TLM5A_ci0fAPF3";

export const supabase = createClient(
    SUPABASE_URL, 
    SUPABASE_PUBLISHABLE_KEY, 
    {
        auth: {
            storage: AsyncStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
        },
    }
);
