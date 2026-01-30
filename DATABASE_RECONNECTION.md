# Database Reconnection Handling

This document describes the automatic reconnection logic implemented to handle brief database restarts, such as during Supabase maintenance windows.

## Overview

The application now includes robust reconnection handling at multiple levels to ensure resilience during:
- Supabase scheduled maintenance (e.g., backup infrastructure upgrades)
- Brief network interruptions
- Transient connection failures

## Implementation Details

### 1. Client-Side Supabase Configuration (`lib/supabase.ts`)

The main Supabase client includes:

- **Auto-refresh tokens**: Automatically refreshes authentication tokens
- **Persistent sessions**: Maintains user sessions across reconnections
- **Realtime reconnection**: Exponential backoff for realtime subscriptions
  - Initial retry: 1 second
  - Max retry delay: 10 seconds
  - Automatic reconnection on connection loss

```typescript
realtime: {
  heartbeatIntervalMs: 30000,
  reconnectAfterMs: (tries: number) => {
    return Math.min(1000 * Math.pow(2, tries), 10000)
  },
}
```

### 2. Server-Side Admin Client (`lib/supabase-admin.ts`)

The admin client (used for server-side operations) includes:

- **Health check monitoring**: Lightweight health checks every 60 seconds
- **Automatic client recreation**: If health check fails, the client is recreated
- **Connection validation**: Ensures the connection is healthy before operations

### 3. Retry Utility (`lib/db-retry.ts`)

A comprehensive retry utility that wraps database operations:

**Features:**
- Exponential backoff (100ms → 200ms → 400ms → max 5s)
- Smart error detection (only retries connection/timeout errors)
- Configurable retry attempts (default: 3 retries)
- Detailed logging for debugging

**Usage Example:**
```typescript
const raffle = await withRetry(
  () => getRaffleById(id),
  { maxRetries: 3 }
)
```

**Retryable Errors:**
- Connection errors (ECONNREFUSED, ENOTFOUND, ETIMEDOUT)
- Network failures (fetch failed, connection reset)
- Supabase-specific errors (PostgREST connection issues)

**Non-Retryable Errors:**
- Validation errors (400 Bad Request)
- Authorization errors (403 Forbidden)
- Not found errors (404)
- Business logic errors

### 4. Database Layer Integration

All critical database operations now use retry logic:

**Raffles (`lib/db/raffles.ts`):**
- `getRaffles()` - Fetch all raffles with retry
- `getRaffleById()` - Fetch single raffle with retry
- `getRaffleBySlug()` - Fetch by slug with retry

**Entries (`lib/db/entries.ts`):**
- `getEntryById()` - Fetch entry with retry
- `getEntryByTransactionSignature()` - Fetch by transaction with retry
- `createEntry()` - Create entry with retry
- `updateEntryStatus()` - Update status with retry

**Admins (`lib/db/admins.ts`):**
- `isAdmin()` - Check admin status with retry

### 5. Realtime Subscriptions (`lib/hooks/useRealtimeEntries.ts`)

The realtime hook already includes excellent reconnection logic:

- **Automatic fallback**: Falls back to polling if realtime fails
- **Status monitoring**: Monitors `SUBSCRIBED`, `CLOSED`, `CHANNEL_ERROR` states
- **Timeout detection**: 2-second timeout to detect connection issues
- **Graceful degradation**: Continues functioning via polling if realtime unavailable

## Expected Behavior During Maintenance

### During Brief Restarts (< 5 seconds):

1. **Active connections**: Automatically reconnect with minimal user impact
2. **In-flight requests**: Retry automatically (up to 3 attempts)
3. **Realtime subscriptions**: Reconnect automatically with exponential backoff
4. **User experience**: Brief loading states, no data loss

### During Longer Outages (> 5 seconds):

1. **Failed operations**: Return error after exhausting retries
2. **Realtime**: Falls back to polling (3-second intervals)
3. **User feedback**: Error messages displayed to user
4. **Recovery**: Automatic reconnection when database comes back online

## Monitoring & Debugging

### Console Logs

The retry logic logs detailed information:

```
Database operation failed (attempt 1), retrying... connection timeout
Database operation failed (attempt 2), retrying... connection timeout
Database operation failed after 3 attempts: connection timeout
```

### Health Check Logs

Admin client health checks log warnings:

```
Admin client health check failed, recreating connection: [error details]
```

### Realtime Status Logs

Realtime subscriptions log status changes:

```
Realtime subscription active for raffle: [id]
Realtime subscription closed, falling back to polling
Realtime subscription timeout, using polling fallback
```

## Testing Reconnection Logic

### Manual Testing

1. **Simulate brief restart**:
   - Pause Supabase project in dashboard
   - Wait 2-3 seconds
   - Resume project
   - Verify app continues functioning

2. **Test realtime fallback**:
   - Block realtime connections in browser DevTools
   - Verify polling fallback activates
   - Check console for fallback messages

3. **Test retry logic**:
   - Introduce artificial network delay
   - Verify operations retry and succeed
   - Check retry attempt logs

### Automated Testing

Consider adding integration tests for:
- Connection failure scenarios
- Retry exhaustion handling
- Realtime fallback behavior
- Health check recovery

## Configuration

### Retry Settings

Adjust retry behavior in `lib/db-retry.ts`:

```typescript
const DEFAULT_OPTIONS = {
  maxRetries: 3,           // Number of retry attempts
  initialDelayMs: 100,     // Initial delay before retry
  maxDelayMs: 5000,        // Maximum delay between retries
  backoffMultiplier: 2,    // Exponential backoff multiplier
}
```

### Health Check Interval

Adjust admin client health checks in `lib/supabase-admin.ts`:

```typescript
const HEALTH_CHECK_INTERVAL = 60000 // 60 seconds
```

### Realtime Reconnection

Adjust realtime settings in `lib/supabase.ts`:

```typescript
realtime: {
  heartbeatIntervalMs: 30000,  // Heartbeat interval
  reconnectAfterMs: (tries) => Math.min(1000 * Math.pow(2, tries), 10000)
}
```

## Best Practices

1. **Always use retry wrappers** for critical database operations
2. **Handle errors gracefully** - display user-friendly messages
3. **Monitor logs** during maintenance windows
4. **Test reconnection logic** before major deployments
5. **Keep retry attempts reasonable** (2-3 attempts is usually sufficient)
6. **Use exponential backoff** to avoid overwhelming the database during recovery

## Related Documentation

- [Supabase Backup Infrastructure](https://supabase.com/docs/guides/platform/backups)
- [Connection Pooling Best Practices](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Realtime Subscriptions](https://supabase.com/docs/guides/realtime)

## Maintenance Window Response

During scheduled maintenance (like the Jan 26 - Feb 2, 2026 backup infrastructure upgrade):

✅ **What's Handled Automatically:**
- Brief Postgres restarts (few seconds)
- Connection drops and reconnections
- Realtime subscription recovery
- Failed query retries

⚠️ **What May Require Attention:**
- Long-running transactions may need to be retried by the user
- Admin operations during the exact restart moment may show temporary errors
- Users may see brief loading states during reconnection

## Support

If you encounter persistent connection issues:

1. Check Supabase status page: https://status.supabase.com
2. Review console logs for retry/connection errors
3. Verify environment variables are set correctly
4. Contact Supabase support: https://supabase.help
