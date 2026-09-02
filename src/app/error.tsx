"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Lives at the ROOT segment, not inside (app): the failure originates in
 * (app)/layout.tsx, and a layout's error is only caught by the boundary of its
 * PARENT segment. Placed inside (app) it never fires and you get a bare 500.
 *
 * Setup errors are the common failure here, not runtime bugs: Supabase
 * credentials present but the schema never created, or created but never
 * seeded. Both produce a PostgREST error that means nothing on its own, so this
 * boundary translates the two known cases into the command that fixes them.
 */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const msg = error.message ?? "";
  const missingSchema = /schema cache|does not exist|Could not find the table/i.test(msg);
  const missingSeed = /did you run npm run seed|sim_state/i.test(msg);

  return (
    <div className="flex min-h-svh items-center justify-center p-8">
      <Card className="max-w-lg shadow-none">
        <CardHeader>
          <CardTitle className="text-base">
            {missingSchema ? "Supabase is connected, but the tables don't exist yet" :
             missingSeed ? "Supabase is set up, but there's no data in it yet" :
             "Something went wrong"}
          </CardTitle>
          <CardDescription>
            {missingSchema ? (
              <>
                Run <code className="font-mono">supabase/schema.sql</code> in your project&apos;s
                SQL editor, then <code className="font-mono">npm run seed</code>.
              </>
            ) : missingSeed ? (
              <>
                Run <code className="font-mono">npm run seed</code> to load the committed dataset.
              </>
            ) : (
              "An unexpected error occurred while loading the app."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs break-words whitespace-pre-wrap">{msg}</pre>
          <p className="text-xs text-muted-foreground">
            Removing the Supabase variables from <code className="font-mono">.env.local</code> makes
            the app fall back to the committed dataset in <code className="font-mono">data/</code>,
            which needs no database at all.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={reset}>Try again</Button>
            <Button size="sm" variant="outline" asChild><Link href="/">Back to landing</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
