const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Default mock values so the app doesn't crash before the user sets up their .env
const supabaseUrl = process.env.SUPABASE_URL || 'https://mock-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'mock-anon-key';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };