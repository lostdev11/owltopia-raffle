import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(
  supabaseUrl || '',
  supabaseServiceKey || supabaseAnonKey || ''
)

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

/**
 * POST /api/raffles/[id]/image
 * Upload a replacement image for the raffle. Allowed when the raffle image is missing or broken.
 * Caller must be the raffle creator or a full admin.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator = creatorWallet && session.wallet.trim() === creatorWallet
    const isFullAdmin = (await getAdminRole(session.wallet)) === 'full'
    if (!isCreator && !isFullAdmin) {
      return NextResponse.json(
        { error: 'Only the raffle creator or an admin can upload a replacement image' },
        { status: 403 }
      )
    }

    if (!supabaseUrl) {
      return NextResponse.json(
        { error: 'Image upload is not configured.' },
        { status: 500 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' },
        { status: 400 }
      )
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB.' },
        { status: 400 }
      )
    }

    const timestamp = Date.now()
    const randomString = Math.random().toString(36).substring(2, 15)
    const fileExt = file.name.split('.').pop() || 'jpg'
    const fileName = `raffle-${id}-${timestamp}-${randomString}.${fileExt}`
    const filePath = `nft-images/${fileName}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from('raffle-images')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('[POST /api/raffles/[id]/image] upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload image' },
        { status: 500 }
      )
    }

    const { data: urlData } = supabase.storage
      .from('raffle-images')
      .getPublicUrl(filePath)

    const updated = await updateRaffle(id, { image_url: urlData.publicUrl })
    if (!updated) {
      return NextResponse.json({ error: 'Failed to update raffle' }, { status: 500 })
    }

    return NextResponse.json({
      url: urlData.publicUrl,
      raffle: updated,
    })
  } catch (error) {
    console.error('[POST /api/raffles/[id]/image]', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
