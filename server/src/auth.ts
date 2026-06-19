import type { Request, Response, NextFunction } from "express";
import type { DB } from "./db.ts";

export interface AuthedRequest extends Request {
  userId?: number;
}

/** Bearer token middleware: resolves token -> user_id, touches last_used_at. */
export function authMiddleware(db: DB) {
  const lookup = db.prepare("SELECT user_id FROM tokens WHERE token = ?");
  const touch = db.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?");

  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    const token = match[1].trim();
    const row = lookup.get(token) as { user_id: number } | undefined;
    if (!row) {
      res.status(401).json({ error: "invalid token" });
      return;
    }
    touch.run(new Date().toISOString(), token);
    req.userId = row.user_id;
    next();
  };
}
