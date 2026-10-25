export async function signUp(repo, input) {
  const email = input.email.trim().toLowerCase();
  await repo.insert({ email, name: input.name });
  return { email };
}
