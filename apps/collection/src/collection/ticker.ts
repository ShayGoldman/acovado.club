import type { Ticker } from '@modules/db';
import type { Context } from '@modules/tracing';
import Yahoo from 'yahoo-finance2';

export async function collectTickerData(ticker: Ticker, c: Context) {
  return c.with(`[Yahoo Finance API]: GET quote ${ticker.symbol}`, async (innerCtx) => {
    innerCtx.annotate('ticker.id', ticker.id);
    innerCtx.annotate('ticker.name', ticker.name);
    innerCtx.annotate('ticker.symbol', ticker.symbol);

    innerCtx.log.debug('Fetching ticker data from Yahoo Finance API');

    return await Yahoo.quote(ticker.symbol)
      .then((quote) => {
        innerCtx.log.debug(quote, 'Fetched ticker data from Yahoo Finance API');
        return quote;
      })
      .catch((err) => {
        innerCtx.log.error({ err }, 'Failed to collect ticker data');
        return null;
      });
  });
}
