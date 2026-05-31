'use client'

import { useMemo, useState } from 'react'
import { format, startOfDay } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function parseLocalDateTimeValue(value: string): {
  date: Date | undefined
  hours: number
  minutes: number
} {
  if (!value?.includes('T')) {
    return { date: undefined, hours: 0, minutes: 0 }
  }
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hours, minutes = 0] = timePart.split(':').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { date: undefined, hours: 0, minutes: 0 }
  }
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) {
    return { date: undefined, hours: 0, minutes: 0 }
  }
  return {
    date,
    hours: Number.isFinite(hours) ? hours : 0,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  }
}

export function buildLocalDateTimeValue(date: Date, hours: number, minutes: number): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(hours)}:${pad2(minutes)}`
}

function localDateTimeBoundToDay(bound: string | undefined): Date | undefined {
  if (!bound) return undefined
  const { date } = parseLocalDateTimeValue(bound)
  return date
}

export type DateTimePickerProps = {
  id: string
  name?: string
  value: string
  onChange: (value: string) => void
  /** datetime-local min/max (local timezone) */
  min?: string
  max?: string
  required?: boolean
  className?: string
  datePlaceholder?: string
}

export function DateTimePicker({
  id,
  name,
  value,
  onChange,
  min,
  max,
  required,
  className,
  datePlaceholder = 'Choose date',
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false)
  const { date, hours, minutes } = parseLocalDateTimeValue(value)
  const minDay = localDateTimeBoundToDay(min)
  const maxDay = localDateTimeBoundToDay(max)

  const timeInputValue = useMemo(() => {
    if (!date) return ''
    return `${pad2(hours)}:${pad2(minutes)}`
  }, [date, hours, minutes])

  const dateLabel = date ? format(date, 'EEE, MMM d, yyyy') : datePlaceholder

  const emit = (nextDate: Date, nextHours: number, nextMinutes: number) => {
    onChange(buildLocalDateTimeValue(nextDate, nextHours, nextMinutes))
  }

  const handleDaySelect = (selected: Date | undefined) => {
    if (!selected) return
    const base = date ?? selected
    emit(
      new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()),
      date ? hours : base.getHours(),
      date ? minutes : base.getMinutes()
    )
    setOpen(false)
  }

  const handleTimeChange = (timeStr: string) => {
    const [hRaw, mRaw] = timeStr.split(':')
    const h = parseInt(hRaw ?? '0', 10)
    const m = parseInt(mRaw ?? '0', 10)
    const baseDate = date ?? new Date()
    emit(baseDate, Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0)
  }

  const isDayDisabled = (day: Date) => {
    const d = startOfDay(day)
    if (minDay && d < startOfDay(minDay)) return true
    if (maxDay && d > startOfDay(maxDay)) return true
    return false
  }

  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-2', className)}>
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            id={id}
            aria-required={required}
            className={cn(
              'min-h-[44px] w-full justify-start gap-2 px-3 font-normal touch-manipulation',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            <span className="truncate text-left text-base sm:text-sm">{dateLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleDaySelect}
            disabled={isDayDisabled}
            defaultMonth={date ?? minDay ?? new Date()}
          />
        </PopoverContent>
      </Popover>
      <div className="space-y-1">
        <label htmlFor={`${id}-time`} className="sr-only">
          Time
        </label>
        <Input
          id={`${id}-time`}
          type="time"
          value={timeInputValue}
          onChange={(e) => handleTimeChange(e.target.value)}
          required={required && !!date}
          disabled={!date}
          className="min-h-[44px] touch-manipulation text-base sm:text-sm"
        />
      </div>
    </div>
  )
}
