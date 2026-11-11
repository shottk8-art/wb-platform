import { ApiError } from './core.ts';

// Temporary, exact-identity pilot. Names and user-editable Telegram metadata
// never authorize the experiment; ordinary shop membership is insufficient.
export const DAILY_SHOP_ID = '853b81a0-e0e2-4195-bc80-1cdc362af946';
export const DAILY_USER_ID = 'bbb002c4-cd7a-490d-b9c0-72aed5424261';
export function dailyAllowed(userId: string, shopId: string) {
  return userId === DAILY_USER_ID && shopId === DAILY_SHOP_ID;
}
export function authorizeDaily(userId: string, shopId: string) {
  if (!dailyAllowed(userId,shopId)) throw new ApiError(403,'Тестовая аналитика недоступна');
}
