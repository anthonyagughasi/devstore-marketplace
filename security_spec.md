# DevStore Firestore Security Specification

## 1. Data Invariants

1. **Identity Integrity**: Every user-owned document (`users/{userId}`, `addresses`, `wishlist`, `notifications`, `followedSellers`, `stores`, `sellerApplications`, `products`, `orders`, `withdrawals`, `reviews`, `productQuestions`, `disputes`) must bind its owner/author UID field directly to `request.auth.uid` on creation and keep it immutable on updates.
2. **Privilege Escalation Prevention**: Users cannot self-assign `role: "admin"` on `users/{userId}` creation, cannot modify `role` or `accountStatus` on self-update, and cannot write to `admins/{userId}`, `platformConfig`, `departments`, `coupons`, or `auditLogs`.
3. **PII Isolation**: Sensitive PII (`email`, `phone`) resides strictly in `users/{userId}/private/{docId}` and `users/{userId}/addresses/{addressId}` and is readable only by the owning user or verified admin.
4. **Product Moderation Integrity**: Sellers cannot self-approve products (`approvalStatus` must start as `'pending'` or `'draft'`, never `'approved'`). Only verified administrators may transition `approvalStatus` to `'approved'` or `'rejected'`, or toggle `isFeatured`.
5. **Financial Integrity**: Sellers cannot self-approve withdrawals (`status` must start as `'pending'`); `sellerOrders` commission fields (`commissionRateBps`, `commissionMinor`, `netEarningsMinor`, `grossMinor`) are immutable after creation; `transactions` and `auditLogs` are append-only (`update` and `delete` denied).
6. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps on Firestore writes must equal `request.time`.
7. **Strict List Query Enforcement**: Collection `list` queries on private collections (`orders`, `sellerOrders`, `withdrawals`, `transactions`, `disputes`, `digitalEntitlements`, `sellerApplications`) require `resource.data` ownership/role match (`customerId == request.auth.uid`, `sellerId == request.auth.uid`, or `isAdmin()`), never `allow list: if isSignedIn()`.

## 2. Adversarial "Dirty Dozen" Payloads

1. **Privilege Escalation on User Create**: `users/{uid}` payload with `role: "admin"` -> **DENIED**.
2. **Shadow Field Injection on User Update**: `users/{uid}` update injecting `accountStatus: "active"` or `role: "admin"` -> **DENIED**.
3. **Cross-User PII Read**: Non-admin user reading `users/otherUid/private/info` -> **DENIED**.
4. **Product Self-Approval**: Seller creating `products/{id}` with `approvalStatus: "approved"` -> **DENIED**.
5. **Seller Tampering with Commission**: Seller updating `sellerOrders/{id}` to modify `commissionMinor` or `netEarningsMinor` -> **DENIED**.
6. **Self-Approved Withdrawal**: Seller creating `withdrawals/{id}` with `status: "approved"` -> **DENIED**.
7. **Post-Approval Withdrawal Mutation**: Seller updating `withdrawals/{id}` after `status` becomes `'approved'` -> **DENIED**.
8. **ID Poisoning**: Creating `products/../../etc/passwd` or 500-char document ID -> **DENIED** (`isValidId()`).
9. **Spoofed Unverified Admin**: Request with admin email claim where `email_verified == false` -> **DENIED**.
10. **Order Hijacking**: Customer creating `orders/{id}` with `customerId: "victimUid"` -> **DENIED**.
11. **Backdated Timestamp**: Creating `reviews/{id}` with `createdAt` in the past instead of `request.time` -> **DENIED**.
12. **Blanket Order List Scrape**: Customer listing `/orders` without filtering to `customerId == request.auth.uid` -> **DENIED**.
