/**
 * lib/auth.ts
 *
 * NextAuth v5 configuration.
 * Exposes `auth`, `signIn`, `signOut` for use in Server Components and API routes.
 *
 * Strategy: Google OAuth login for staff. The session carries the user's
 * Google access + refresh tokens so server actions can call Google APIs on
 * their behalf when needed (e.g. sending email as them).
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { auth, signIn, signOut, handlers } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Request offline access so we get a refresh token
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/gmail.send",
          ].join(" "),
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Persist Google tokens into the JWT on first login
      if (account) {
        token.accessToken  = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt    = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose tokens to server-side code via session
      (session as { accessToken?: string }).accessToken  = token.accessToken as string;
      (session as { refreshToken?: string }).refreshToken = token.refreshToken as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
