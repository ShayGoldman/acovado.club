import Z from 'zod';

// Complete input schema: All fields are required
export const CompleteInputSchema = Z.object({
  tickers: Z.array(Z.string()).nonempty('At least one ticker must be selected.'),
  start: Z.string().datetime(),
  end: Z.string().datetime(),
  type: Z.string(),
  delay: Z.number().nonnegative(),
});

// Partial input schema: For initial CLI arguments
export const PartialInputsSchema = CompleteInputSchema.omit({
  start: true,
  end: true,
  delay: true,
})
  .extend({
    delay: Z.coerce.number().nonnegative(),
    start: Z.string().date().optional(),
    end: Z.string().date().optional(),
    day: Z.string()
      .optional()
      .refine((val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), {
        message: 'Day must be in YYYY-MM-DD format.',
      }),
    tickers: Z.preprocess(
      (val) => (typeof val === 'string' ? val.split(',').map((v) => v.trim()) : val),
      Z.array(Z.string()).optional(),
    ),
  })
  .partial();

// Types
export type CompleteInputs = Z.infer<typeof CompleteInputSchema>;
export type PartialInputs = Z.infer<typeof PartialInputsSchema>;
