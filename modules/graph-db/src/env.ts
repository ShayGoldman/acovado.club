import Z from 'zod';

export type Environment = Z.infer<typeof environmentSchema>;

const environmentSchema = Z.object({
  // Format: redis[s]://[[username][:password]@][host][:port][/db-number]
  // Example: redis://:mypassword@localhost:6379
  GRAPH_DB_URL: Z.string().url(),
});

export default environmentSchema.parse(process.env);
