import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import {
  userProfileApplyPatch,
  type UserProfileDto,
} from '@/lib/user-profile-api'

const updateUserProfileInputSchema = z.object({
  displayName: z
    .string()
    .nullable()
    .optional()
    .describe('User display name. Omit if unchanged. Pass null or "" to clear.'),
  location: z
    .string()
    .nullable()
    .optional()
    .describe('City, region, or country. Omit if unchanged. null or "" clears.'),
  preferredLanguages: z
    .array(z.string())
    .optional()
    .describe(
      'Languages the user prefers for responses. Replaces the list when provided; omit if unchanged.',
    ),
  timezoneNote: z
    .string()
    .nullable()
    .optional()
    .describe('Timezone or locale hint. Omit if unchanged. null or "" clears.'),
  notes: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Longer freeform context (role, industry, preferences). Omit if unchanged. null or "" clears.',
    ),
})

const updateUserProfileTool = toolDefinition({
  name: 'update_user_profile',
  description: `Persist facts about the user for all Braian workspaces. Only include fields the user confirmed or clearly stated; omit fields you are not updating. After success, briefly acknowledge what you saved.`,
  inputSchema: updateUserProfileInputSchema,
})

export function buildUserProfileTools() {
  return [
    updateUserProfileTool.server(async (args) => {
      const input = updateUserProfileInputSchema.parse(args)
      const patch: Parameters<typeof userProfileApplyPatch>[0] = {}
      if ('displayName' in input) patch.displayName = input.displayName ?? null
      if ('location' in input) patch.location = input.location ?? null
      if ('timezoneNote' in input) patch.timezoneNote = input.timezoneNote ?? null
      if ('notes' in input) patch.notes = input.notes ?? null
      if (input.preferredLanguages !== undefined) {
        patch.preferredLanguages = input.preferredLanguages
      }

      const next: UserProfileDto = userProfileApplyPatch(patch)

      return {
        ok: true as const,
        saved: next,
        message:
          'Profile updated. Other chats in Braian will see this context on their next message.',
      }
    }),
  ]
}
