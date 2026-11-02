import { randomUUID } from 'node:crypto';
import type {
  NewUser,
  OneTimeTokenRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  UserRecord,
  UserRepository,
  UserRole
} from '../../src/repositories/authRepositories.js';
import type {
  GarageRepository,
  GarageVehiclePatch,
  GarageVehicleRecord,
  NewGarageVehicle
} from '../../src/repositories/garageRepository.js';
import type { InspectionChange, VehicleRecord, VehicleRepository } from '../../src/repositories/vehicleRepository.js';

export class MemoryUserRepository implements UserRepository {
  readonly users = new Map<string, UserRecord>();

  async findByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async findById(id: string) {
    return this.users.get(id) ?? null;
  }

  async create({ email, passwordHash, termsAcceptedAt, termsVersion }: NewUser) {
    if (await this.findByEmail(email)) return null;
    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash,
      role: 'user',
      emailVerifiedAt: null,
      termsAcceptedAt: termsAcceptedAt.toISOString(),
      termsVersion,
      createdAt: new Date().toISOString()
    };
    this.users.set(user.id, user);
    return user;
  }

  async updatePassword(id: string, passwordHash: string) {
    const user = this.users.get(id);
    if (user) user.passwordHash = passwordHash;
  }

  async markEmailVerified(id: string, at: Date) {
    const user = this.users.get(id);
    if (user && !user.emailVerifiedAt) user.emailVerifiedAt = at.toISOString();
  }

  async updateRole(id: string, role: UserRole) {
    const user = this.users.get(id);
    if (user) user.role = role;
  }

  async delete(id: string) {
    this.users.delete(id);
    for (const listener of this.onDelete) listener(id);
  }

  /** Simula el ON DELETE CASCADE de la base en los demás repositorios en memoria. */
  readonly onDelete: Array<(userId: string) => void> = [];

  setRole(email: string, role: UserRole) {
    const user = [...this.users.values()].find((item) => item.email === email);
    if (user) user.role = role;
  }
}

interface ResetTokenRow {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export class MemoryOneTimeTokenRepository implements OneTimeTokenRepository {
  readonly tokens: ResetTokenRow[] = [];

  async create(userId: string, tokenHash: string, expiresAt: Date) {
    this.tokens.push({ userId, tokenHash, expiresAt, usedAt: null });
  }

  async consume(tokenHash: string, now: Date) {
    const token = this.tokens.find((row) => row.tokenHash === tokenHash && !row.usedAt && row.expiresAt > now);
    if (!token) return null;
    for (const row of this.tokens) {
      if (row.userId === token.userId && !row.usedAt) row.usedAt = now;
    }
    return token.userId;
  }
}

export const MemoryPasswordResetTokenRepository = MemoryOneTimeTokenRepository;
export type MemoryPasswordResetTokenRepository = MemoryOneTimeTokenRepository;

interface RefreshTokenRow extends RefreshTokenRecord {
  expiresAt: Date;
  revokedAt: Date | null;
}

export class MemoryRefreshTokenRepository implements RefreshTokenRepository {
  readonly tokens = new Map<string, RefreshTokenRow>();

  async create(token: RefreshTokenRecord, expiresAt: Date) {
    this.tokens.set(token.id, { ...token, expiresAt, revokedAt: null });
  }

  async revokeIfActive(id: string, now: Date) {
    const row = this.tokens.get(id);
    if (!row || row.revokedAt || row.expiresAt <= now) return null;
    row.revokedAt = now;
    return { id: row.id, userId: row.userId, familyId: row.familyId };
  }

  async revokeFamily(familyId: string, now: Date) {
    for (const row of this.tokens.values()) if (row.familyId === familyId && !row.revokedAt) row.revokedAt = now;
  }

  async revokeAllForUser(userId: string, now: Date) {
    for (const row of this.tokens.values()) if (row.userId === userId && !row.revokedAt) row.revokedAt = now;
  }

  activeCount(userId: string) {
    return [...this.tokens.values()].filter((row) => row.userId === userId && !row.revokedAt).length;
  }
}

export class MemoryVehicleRepository implements VehicleRepository {
  constructor(
    private readonly vehicles: VehicleRecord[],
    private readonly users: MemoryUserRepository
  ) {}

  async findAll() {
    return structuredClone(this.vehicles);
  }

  async findByPlate(plate: string) {
    const vehicle = this.vehicles.find((item) => item.plate === plate);
    return vehicle ? structuredClone(vehicle) : null;
  }

  async updateInspection(plate: string, code: string, change: InspectionChange, userId: string) {
    const vehicle = this.vehicles.find((item) => item.plate === plate);
    const inspection = vehicle?.inspections.find((item) => item.code === code);
    if (!vehicle || !inspection) return false;
    const now = new Date().toISOString();
    Object.assign(inspection, change, { updatedByEmail: (await this.users.findById(userId))?.email ?? null, updatedAt: now });
    vehicle.updatedAt = now;
    return true;
  }
}

export class MemoryGarageRepository implements GarageRepository {
  readonly vehicles: GarageVehicleRecord[] = [];

  async list(userId: string) {
    return this.vehicles.filter((item) => item.userId === userId).sort((a, b) => a.plate.localeCompare(b.plate)).map((item) => ({ ...item }));
  }

  async find(userId: string, plate: string) {
    const found = this.vehicles.find((item) => item.userId === userId && item.plate === plate);
    return found ? { ...found } : null;
  }

  async count(userId: string) {
    return this.vehicles.filter((item) => item.userId === userId).length;
  }

  async create(userId: string, vehicle: NewGarageVehicle) {
    if (this.vehicles.some((item) => item.userId === userId && item.plate === vehicle.plate)) return null;
    const now = new Date().toISOString();
    const record: GarageVehicleRecord = { ...vehicle, id: randomUUID(), userId, createdAt: now, updatedAt: now };
    this.vehicles.push(record);
    return { ...record };
  }

  async update(userId: string, plate: string, patch: GarageVehiclePatch) {
    const found = this.vehicles.find((item) => item.userId === userId && item.plate === plate);
    if (!found) return null;
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) Object.assign(found, { [key]: value });
    found.updatedAt = new Date().toISOString();
    return { ...found };
  }

  async delete(userId: string, plate: string) {
    const index = this.vehicles.findIndex((item) => item.userId === userId && item.plate === plate);
    if (index < 0) return false;
    this.vehicles.splice(index, 1);
    return true;
  }

  deleteAllFor(userId: string) {
    for (let index = this.vehicles.length - 1; index >= 0; index--) if (this.vehicles[index]!.userId === userId) this.vehicles.splice(index, 1);
  }
}
