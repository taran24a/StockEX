import { Router } from "express";
import { AdminUserSchema, AdminUsersResponseSchema } from "@tradewise/shared";
import type { Pool } from "pg";
import { authenticate, requireRole } from "../middleware/authenticate.js";

interface AdminUserRow {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  created_at: Date;
}

export function createAdminRouter(pool: Pool, secret: string): Router {
  const router = Router();

  router.get(
    "/users",
    authenticate(secret),
    requireRole("admin"),
    async (_request, response) => {
      const result = await pool.query<AdminUserRow>(
        `SELECT id, email, display_name, role, created_at
         FROM users
         ORDER BY created_at DESC
         LIMIT 100`
      );
      const users = result.rows.map((row) => AdminUserSchema.parse({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        createdAt: row.created_at.toISOString()
      }));
      response.json(AdminUsersResponseSchema.parse({ users }));
    }
  );

  return router;
}
