import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

const environmentSchema = Z.object({
  DATABASE_URL: Z.string().url(),

  // TODO extract this to a separate module with
  RESET_DB: Z.enum(['true', 'false', '1', '0', ''])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export default environmentSchema.parse(process.env);
