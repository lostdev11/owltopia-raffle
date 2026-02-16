import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

// Create a server-side Supabase client with service role key for uploads
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(
  supabaseUrl || '',
  supabaseServiceKey || supabaseAnonKey || ''
)

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session
    const formData = await request.formData()

    // Check if Supabase is configured
    if (!supabaseUrl) {
      return NextResponse.json(
        { error: 'Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL in your environment variables.' },
        { status: 500 }
      )
    }

    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!validImageTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.' },
        { status: 400 }
      )
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024 // 10MB in bytes
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size too large. Maximum size is 10MB.' },
        { status: 400 }
      )
    }

    // Generate unique filename
    const timestamp = Date.now()
    const randomString = Math.random().toString(36).substring(2, 15)
    const fileExt = file.name.split('.').pop()
    const fileName = `${timestamp}-${randomString}.${fileExt}`
    const filePath = `nft-images/${fileName}`

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('raffle-images')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Error uploading file to Supabase:', uploadError)
      
      // Provide more specific error messages
      let errorMessage = 'Failed to upload image'
      if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('does not exist')) {
        errorMessage = 'Storage bucket "raffle-images" does not exist. Please create it in your Supabase dashboard.'
      } else if (uploadError.message?.includes('new row violates row-level security')) {
        errorMessage = 'Permission denied. Please check your Supabase storage policies.'
      } else if (uploadError.message) {
        errorMessage = `Upload failed: ${uploadError.message}`
      }
      
      return NextResponse.json(
        { error: errorMessage, details: uploadError.message },
        { status: 500 }
      )
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('raffle-images')
      .getPublicUrl(filePath)

    return NextResponse.json(
      { url: urlData.publicUrl, path: filePath },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error in image upload:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
