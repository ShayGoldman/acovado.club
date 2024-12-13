import type { Ticker } from '@modules/db';
import Yahoo from 'yahoo-finance2';

export async function collectTickerData(ticker: Ticker) {
  return await Yahoo.quote(ticker.symbol);
}
