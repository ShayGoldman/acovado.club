import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

const environmentSchema = Z.object({
  DATABASE_URL: Z.string().url(),
  RESET_DB: Z.coerce.boolean().default(false),
});

export default environmentSchema.parse(process.env);
