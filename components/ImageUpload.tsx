'use client'

import { useState, useRef, useEffect, ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import Image from 'next/image'
import { Upload, X, Loader2 } from 'lucide-react'

interface ImageUploadProps {
  value?: string | null
  onChange: (url: string | null) => void
  label?: string
  disabled?: boolean
}

export function ImageUpload({ value, onChange, label = 'Image', disabled = false }: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(value || null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync preview with value prop
  useEffect(() => {
    setPreview(value || null)
  }, [value])

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!validImageTypes.includes(file.type)) {
      setError('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.')
      return
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      setError('File size too large. Maximum size is 10MB.')
      return
    }

    setError(null)
    setUploading(true)

    // Create preview immediately
    const previewUrl = URL.createObjectURL(file)
    setPreview(previewUrl)

    try {
      // Upload to API
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to upload image')
      }

      const data = await response.json()
      
      // Clean up preview URL
      URL.revokeObjectURL(previewUrl)
      
      setPreview(data.url)
      onChange(data.url)
    } catch (err) {
      console.error('Error uploading image:', err)
      setError(err instanceof Error ? err.message : 'Failed to upload image')
      setPreview(value || null)
      URL.revokeObjectURL(previewUrl)
    } finally {
      setUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleRemove = () => {
    setPreview(null)
    onChange(null)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleClick = () => {
    if (!disabled && !uploading) {
      fileInputRef.current?.click()
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      
      {preview ? (
        <div className="relative group">
          <div className="!relative w-full h-48 rounded-md overflow-hidden border border-input">
            <Image
              src={preview}
              alt="Preview"
              fill
              className="object-cover"
              unoptimized
            />
          </div>
          {!disabled && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={handleRemove}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : (
        <div
          onClick={handleClick}
          className={`relative border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors ${
            disabled || uploading
              ? 'border-muted bg-muted/50 cursor-not-allowed'
              : 'border-input hover:border-primary/50 hover:bg-accent/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
            onChange={handleFileSelect}
            disabled={disabled || uploading}
            className="hidden"
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Uploading...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <div className="text-sm">
                <span className="text-primary font-medium">Click to upload</span>
                <span className="text-muted-foreground"> or drag and drop</span>
              </div>
              <p className="text-xs text-muted-foreground">
                PNG, JPG, GIF or WebP (max. 10MB)
              </p>
            </div>
          )}
        </div>
      )}

      {/* URL input as fallback */}
      <div className="mt-2">
        <div className="text-sm text-muted-foreground mb-2">
          Or paste an image URL:
        </div>
        <Input
          type="url"
          placeholder="https://example.com/image.jpg"
          value={value || ''}
          onChange={(e) => {
            const url = e.target.value || null
            onChange(url)
          }}
          disabled={disabled || uploading}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
