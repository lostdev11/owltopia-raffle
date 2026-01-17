'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { OwlVisionBadge } from '@/components/OwlVisionBadge'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import type { Raffle, Entry } from '@/lib/types'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { getThemeAccentBorderStyle, getThemeAccentClasses } from '@/lib/theme-accent'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTimeWithTimezone } from '@/lib/utils'
import { Trash2, Edit, LayoutGrid, Square } from 'lucide-react'
import Image from 'next/image'

type CardSize = 'small' | 'medium' | 'large'

interface RaffleCardProps {
  raffle: Raffle
  entries: Entry[]
  size?: CardSize
  onDeleted?: (raffleId: string) => void
  priority?: boolean
}

export function RaffleCard({ raffle, entries, size = 'medium', onDeleted, priority = false }: RaffleCardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { publicKey, connected } = useWallet()
  const [isAdmin, setIsAdmin] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedSize, setExpandedSize] = useState<CardSize>('large')
  
  const owlVisionScore = calculateOwlVisionScore(raffle, entries)
  const isActive = new Date(raffle.end_time) > new Date() && raffle.is_active
  const borderStyle = getThemeAccentBorderStyle(raffle.theme_accent)

  // Check admin status
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!connected || !publicKey) {
        setIsAdmin(false)
        return
      }

      try {
        const response = await fetch(`/api/admin/check?wallet=${publicKey.toBase58()}`)
        if (response.ok) {
          const data = await response.json()
          setIsAdmin(data.isAdmin === true)
        } else {
          setIsAdmin(false)
        }
      } catch (error) {
        console.error('Error checking admin status:', error)
        setIsAdmin(false)
      }
    }

    checkAdminStatus()
  }, [connected, publicKey])

  const handleDelete = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    console.log('handleDelete called', { connected, publicKey: publicKey?.toBase58(), isAdmin, raffleId: raffle.id })

    if (!connected || !publicKey) {
      alert('Please connect your wallet to delete a raffle')
      setDeleteDialogOpen(false)
      return
    }

    if (!isAdmin) {
      alert('Only admins can delete raffles')
      setDeleteDialogOpen(false)
      return
    }

    setDeleting(true)

    try {
      const walletAddress = publicKey.toBase58()
      console.log('Sending delete request', { raffleId: raffle.id, walletAddress })
      
      const response = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'x-wallet-address': walletAddress
        },
        body: JSON.stringify({ wallet_address: walletAddress }),
      })

      console.log('Delete response status:', response.status)

      if (response.ok) {
        const result = await response.json().catch(() => ({ success: true }))
        console.log('Delete successful:', result)
        // Close dialog
        setDeleteDialogOpen(false)
        // Immediately remove from UI if callback provided (client-side update)
        if (onDeleted) {
          console.log('Removing raffle from UI:', raffle.id)
          onDeleted(raffle.id)
          // Don't refresh if we're on the raffles page - client-side update is sufficient
          // The server will have the correct data on next navigation/refresh
        } else {
          console.log('No onDeleted callback provided, using router refresh only')
          // If no callback, refresh immediately (fallback)
          router.refresh()
        }
        // If on a detail page, navigate to raffles list
        if (pathname?.startsWith('/raffles/')) {
          router.push('/raffles')
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('Delete failed:', errorData)
        alert(errorData.error || 'Error deleting raffle')
      }
    } catch (error) {
      console.error('Error deleting raffle:', error)
      alert('Error deleting raffle. Please check the console for details.')
    } finally {
      setDeleting(false)
    }
  }

  // Small size - List format (horizontal)
  // When expanded, render as medium/large card format
  if (size === 'small' && !isExpanded) {
    return (
      <div className="relative">
        <Link 
          href={`/raffles/${raffle.slug}`}
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (target.closest('button')) {
              e.preventDefault()
            }
          }}
        >
          <Card
            className={getThemeAccentClasses(raffle.theme_accent, 'hover:scale-[1.02] cursor-pointer flex flex-row')}
            style={borderStyle}
          >
            {raffle.image_url && (
              <div 
                className="relative w-24 h-24 flex-shrink-0 overflow-hidden cursor-pointer"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setImageModalOpen(true)
                }}
              >
                <Image
                  src={raffle.image_url}
                  alt={raffle.title}
                  fill
                  sizes="96px"
                  className="object-cover"
                  priority={priority}
                />
              </div>
            )}
            <div className="flex-1 flex flex-col p-3 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <CardTitle className="text-sm font-semibold line-clamp-1 flex-1">{raffle.title}</CardTitle>
                <div className="flex items-center gap-2">
                  <OwlVisionBadge score={owlVisionScore} />
                </div>
              </div>
            <CardDescription className="text-xs text-muted-foreground line-clamp-1 mb-2">
              {raffle.description}
            </CardDescription>
            <div className="flex items-center gap-4 text-xs mb-2">
              {raffle.prize_amount && raffle.prize_currency && (
                <span>
                  <span className="text-muted-foreground">Prize: </span>
                  <span className="font-semibold">{raffle.prize_amount} {raffle.prize_currency}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Price: </span>
                <span className="font-semibold flex items-center gap-1.5">
                  {raffle.ticket_price} {raffle.currency}
                  <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={14} className="inline-block" />
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">Entries: </span>
                <span className="font-semibold">{owlVisionScore.confirmedEntries}</span>
              </span>
            </div>
            <div className="flex items-center justify-between mt-auto">
              <span className="text-xs text-muted-foreground">
                {isActive ? (
                  <span title={formatDateTimeWithTimezone(raffle.end_time)}>
                    Ends {formatDistanceToNow(new Date(raffle.end_time), { addSuffix: true })}
                  </span>
                ) : (
                  <span title={formatDateTimeWithTimezone(raffle.end_time)}>Ended</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs">
                  {isActive ? 'Active' : 'Ended'}
                </Badge>
                <Button 
                  type="button"
                  size="sm" 
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsExpanded(!isExpanded)
                    if (!isExpanded) {
                      // When expanding, default to large size
                      setExpandedSize('large')
                    }
                  }}
                >
                  {isExpanded ? 'Collapse' : isActive ? 'Enter' : 'View'}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </Link>
      {isAdmin && (
        <>
          <div className="absolute top-2 right-2 z-10 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0 bg-background"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                router.push(`/admin/raffles/${raffle.id}`)
              }}
            >
              <Edit className="h-4 w-4" />
            </Button>
            {isActive && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDeleteDialogOpen(true)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Raffle</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete "{raffle.title}"? This action cannot be undone and will also delete all associated entries.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleDelete(e)
                  }}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete Raffle'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
            <DialogContent className="max-w-5xl w-full p-0">
              {raffle.image_url && (
                <div className="relative w-full h-[80vh] min-h-[500px]">
                  <Image
                    src={raffle.image_url}
                    alt={raffle.title}
                    fill
                    sizes="100vw"
                    className="object-contain"
                    priority={priority}
                  />
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
    )
  }

  // Medium and Large sizes - Card format (vertical)
  const sizeClasses = {
    medium: {
      image: 'aspect-[4/3]',
      title: 'text-lg',
      description: 'text-sm line-clamp-2',
      content: 'text-sm space-y-2',
      footer: 'text-xs gap-2',
      header: '',
      contentPadding: 'pt-4',
      footerPadding: '',
    },
    large: {
      image: 'aspect-[4/3]',
      title: 'text-xl',
      description: 'text-base line-clamp-3',
      content: 'text-base space-y-3',
      footer: 'text-sm gap-3',
      header: 'p-6',
      contentPadding: 'pt-6 px-6',
      footerPadding: 'p-6',
    },
  }

  // When expanded, use the expanded size setting; otherwise use the global size
  // If size is 'small' but not expanded, handle separately above
  // When expanded with small size, default to 'large' for the card view
  let displaySize: 'medium' | 'large'
  if (isExpanded) {
    displaySize = expandedSize === 'medium' ? 'medium' : 'large'
  } else {
    displaySize = size === 'medium' ? 'medium' : 'large'
  }
  const classes = sizeClasses[displaySize]

  return (
    <div className={`relative ${isExpanded ? 'col-span-full z-50' : ''}`}>
      <Link 
        href={isExpanded ? '#' : `/raffles/${raffle.slug}`} 
        onClick={(e) => {
          if (isExpanded) {
            e.preventDefault()
          }
          // Stop propagation for any clicks inside to prevent Link navigation when buttons are clicked
          const target = e.target as HTMLElement
          if (target.closest('button')) {
            e.preventDefault()
          }
        }}
      >
        <Card
          className={getThemeAccentClasses(raffle.theme_accent, `h-full flex flex-col ${isExpanded ? '' : 'hover:scale-105 cursor-pointer'}`)}
          style={borderStyle}
        >
          <CardHeader className={classes.header}>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className={`${classes.title} ${isExpanded ? '' : 'line-clamp-2'}`}>{raffle.title}</CardTitle>
              <div className="flex items-center gap-2">
                {isExpanded && (
                  <div className="flex items-center gap-1 border rounded-md p-1 bg-background/50">
                    <Button
                      type="button"
                      variant={expandedSize === 'medium' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        console.log('Setting expandedSize to medium')
                        setExpandedSize('medium')
                      }}
                      className="h-7 px-2"
                      title="Medium"
                    >
                      <LayoutGrid className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant={expandedSize === 'large' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        console.log('Setting expandedSize to large')
                        setExpandedSize('large')
                      }}
                      className="h-7 px-2"
                      title="Large"
                    >
                      <Square className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                <OwlVisionBadge score={owlVisionScore} />
              </div>
            </div>
          <CardDescription className={`${classes.description} ${isExpanded ? 'line-clamp-none' : ''}`}>
            {raffle.description}
          </CardDescription>
        </CardHeader>
        {raffle.image_url && (
          <div 
            className={`relative w-full ${classes.image} overflow-hidden cursor-pointer`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setImageModalOpen(true)
            }}
          >
            <Image
              src={raffle.image_url}
              alt={raffle.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 400px"
              className="object-contain"
              priority={priority}
            />
          </div>
        )}
        <CardContent className={`flex-1 ${classes.contentPadding}`}>
          <div className={classes.content}>
            {raffle.prize_amount && raffle.prize_currency && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Prize</span>
                <span className="font-semibold">
                  {raffle.prize_amount} {raffle.prize_currency}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ticket Price</span>
              <span className="font-semibold flex items-center gap-1.5">
                {raffle.ticket_price} {raffle.currency}
                <CurrencyIcon currency={raffle.currency as 'SOL' | 'USDC'} size={16} className="inline-block" />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Entries</span>
              <span className="font-semibold">
                {owlVisionScore.confirmedEntries} confirmed
              </span>
            </div>
          </div>
        </CardContent>
        <CardFooter className={`flex flex-col ${classes.footer} ${classes.footerPadding}`}>
          <div className={`w-full flex items-center justify-between ${displaySize === 'large' ? 'text-sm' : 'text-xs'} text-muted-foreground`}>
            <span>
              {isActive ? (
                <span title={formatDateTimeWithTimezone(raffle.end_time)}>
                  Ends {formatDistanceToNow(new Date(raffle.end_time), { addSuffix: true })}
                </span>
              ) : (
                <span title={formatDateTimeWithTimezone(raffle.end_time)}>Ended</span>
              )}
            </span>
            <Badge variant={isActive ? 'default' : 'secondary'}>
              {isActive ? 'Active' : 'Ended'}
            </Badge>
          </div>
          <Button 
            type="button"
            className="w-full" 
            size={displaySize === 'large' ? 'lg' : 'default'}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsExpanded(!isExpanded)
              if (!isExpanded) {
                // When expanding, default to large size
                setExpandedSize('large')
              }
            }}
          >
            {isExpanded ? 'Collapse' : isActive ? 'Enter Raffle' : 'View Details'}
          </Button>
        </CardFooter>
      </Card>
    </Link>
    {isAdmin && (
      <>
        <div className="absolute top-2 right-2 z-10 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0 bg-background"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              router.push(`/admin/raffles/${raffle.id}`)
            }}
          >
            <Edit className="h-4 w-4" />
          </Button>
          {isActive && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDeleteDialogOpen(true)
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Raffle</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{raffle.title}"? This action cannot be undone and will also delete all associated entries.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleDelete(e)
                }}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete Raffle'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
          <DialogContent className="max-w-5xl w-full p-0">
            {raffle.image_url && (
              <div className="relative w-full h-[80vh] min-h-[500px]">
                <Image
                  src={raffle.image_url}
                  alt={raffle.title}
                  fill
                  sizes="100vw"
                  className="object-contain"
                  priority={priority}
                />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
    )}
    </div>
  )
}
