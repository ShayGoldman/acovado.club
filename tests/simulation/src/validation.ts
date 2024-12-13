import { PartialInputsSchema, type PartialInputs } from './schemas';

export function validateInputs(options: any): PartialInputs {
  const parsedInputs = PartialInputsSchema.safeParse(options);

  if (!parsedInputs.success) {
    console.error('Invalid inputs:', parsedInputs.error.format());
    throw new Error('Input validation failed.');
  }

  return parsedInputs.data;
}
