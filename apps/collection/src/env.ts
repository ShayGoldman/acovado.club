import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

const environmentSchema = Z.object({
  NODE_ENV: Z.enum(['development', 'test', 'production']).default('development'),
  PORT: Z.coerce.number().default(8082),
});

export default environmentSchema.parse(process.env);
