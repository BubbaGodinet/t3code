/**
 * The account a picker row runs as. The instance label is the account name
 * ("Motley Fool", "DoorDash"); the probe email is appended when T3 has one.
 * A single account still uses this label, so a row never falls back to only
 * the driver name when an email or a custom instance name exists.
 */
export function modelPickerAccountLabel(input: {
  readonly displayName: string;
  readonly email?: string | null | undefined;
}): string {
  const name = input.displayName.trim();
  const email = input.email?.trim() ?? "";
  if (name.length === 0) return email;
  if (email.length === 0 || name.localeCompare(email, undefined, { sensitivity: "accent" }) === 0) {
    return name;
  }
  return `${name} · ${email}`;
}

/** Account line under a model name. A catalog sub-provider stays after the account. */
export function modelPickerRowAccountLabel(input: {
  readonly displayName: string;
  readonly email?: string | null | undefined;
  readonly subProvider?: string | null | undefined;
}): string {
  const account = modelPickerAccountLabel(input);
  const subProvider = input.subProvider?.trim() ?? "";
  if (subProvider.length === 0) return account;
  return account.length > 0 ? `${account} · ${subProvider}` : subProvider;
}
