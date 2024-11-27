export type MessageId = `msg_${string}`;

export type ExtractIdPrefix<T extends string> = T extends `${infer P}_${string}`
  ? P
  : never;
