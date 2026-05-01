/**
 * Kill switch: when `CART_BULK_CHECKOUT_ADMIN_ONLY=true`, merged cart endpoints
 * (`/api/entries/create-batch`, `/api/entries/verify-batch`) only accept admins.
 * Unset or any other value → normal buyers can use bulk checkout.
 */
export function bulkCheckoutRestrictedToAdmins(): boolean {
  return process.env.CART_BULK_CHECKOUT_ADMIN_ONLY === 'true'
}
