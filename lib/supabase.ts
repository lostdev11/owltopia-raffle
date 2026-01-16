import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Create a client with fallback values to prevent crashes during development
// In production, these should be set via environment variables
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)

// Helper function to check if Supabase is properly configured
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey && 
    supabaseUrl !== 'https://placeholder.supabase.co' && 
    supabaseAnonKey !== 'placeholder-key')
}

// Helper function to get configuration error message
export function getSupabaseConfigError(): string | null {
  if (!supabaseUrl || supabaseUrl === 'https://placeholder.supabase.co') {
    return 'NEXT_PUBLIC_SUPABASE_URL is missing. Please set it in your .env.local file.'
  }
  if (!supabaseAnonKey || supabaseAnonKey === 'placeholder-key') {
    return 'NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Please set it in your .env.local file.'
  }
  return null
}
