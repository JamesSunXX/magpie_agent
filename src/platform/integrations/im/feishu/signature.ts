export function verifyFeishuChallenge(
  body: { token?: string; challenge?: string },
  options: { verificationToken: string }
): { accepted: boolean; challenge?: string } {
  if (body.token !== options.verificationToken || !body.challenge) {
    return { accepted: false }
  }

  return {
    accepted: true,
    challenge: body.challenge,
  }
}
