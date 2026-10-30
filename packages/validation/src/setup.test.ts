import { describe, expect, it } from 'vitest';
import {
  academicYearDatesSchema,
  createDepartmentSchema,
  institutionProfileSchema,
  parseRoleName,
  userImportRowSchema,
  userInputSchema,
} from './setup.js';

const DEPT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';

describe('institutionProfileSchema', () => {
  it('turns blank optional fields into null', () => {
    const parsed = institutionProfileSchema.parse({
      name: ' Sample College ',
      type: 'affiliated',
      state: 'Andhra Pradesh',
      city: '',
      aisheCode: '  ',
    });
    expect(parsed).toMatchObject({ name: 'Sample College', city: null, aisheCode: null });
  });
});

describe('createDepartmentSchema', () => {
  it('upper-cases the code and rejects odd ones', () => {
    expect(createDepartmentSchema.parse({ name: 'Computer Science', code: ' cse ' }).code).toBe('CSE');
    expect(createDepartmentSchema.safeParse({ name: 'X', code: '1CS' }).success).toBe(false);
    expect(createDepartmentSchema.safeParse({ name: 'X', code: 'C' }).success).toBe(false);
  });
});

describe('userInputSchema', () => {
  const base = { name: 'Sample Person', roles: [{ role: 'iqac' }] };

  it('needs an email or a mobile number', () => {
    expect(userInputSchema.safeParse(base).success).toBe(false);
    expect(userInputSchema.safeParse({ ...base, email: '' , mobile: '' }).success).toBe(false);
    expect(userInputSchema.parse({ ...base, mobile: '+91 98765 43210' }).mobile).toBe('9876543210');
  });

  it('needs a department for HOD and faculty roles', () => {
    const hod = { ...base, email: 'a@example.test', roles: [{ role: 'hod' }] };
    expect(userInputSchema.safeParse(hod).success).toBe(false);
    expect(userInputSchema.safeParse({ ...hod, roles: [{ role: 'hod', departmentId: DEPT }] }).success).toBe(true);
  });

  it('never allows the super admin role, or the same role twice', () => {
    expect(userInputSchema.safeParse({ ...base, email: 'a@example.test', roles: [{ role: 'super_admin' }] }).success).toBe(false);
    expect(
      userInputSchema.safeParse({ ...base, email: 'a@example.test', roles: [{ role: 'iqac' }, { role: 'iqac' }] }).success,
    ).toBe(false);
  });
});

describe('spreadsheet rows', () => {
  it('understands the role names people actually type', () => {
    expect(parseRoleName('HOD')).toBe('hod');
    expect(parseRoleName('  IQAC   coordinator ')).toBe('iqac');
    expect(parseRoleName('Faculty')).toBe('faculty');
    expect(parseRoleName('Principal / Dean')).toBe('principal');
    expect(parseRoleName('super_admin')).toBeNull();
    expect(parseRoleName('chancellor')).toBeNull();
  });

  it('reads numbers from cells and checks each row', () => {
    const row = userImportRowSchema.parse({ name: 'A', mobile: 9876543210, role: 'Faculty', departmentCode: 'cse' });
    expect(row).toMatchObject({ mobile: '9876543210', role: 'faculty', departmentCode: 'CSE', email: null });
    expect(userImportRowSchema.safeParse({ name: 'A', mobile: 9876543210, role: 'Faculty' }).success).toBe(false);
    expect(userImportRowSchema.safeParse({ name: 'A', mobile: 9876543210, role: 'Wizard' }).success).toBe(false);
  });
});

describe('academicYearDatesSchema', () => {
  const year = { startDate: '2026-07-01', endDate: '2027-06-30' };

  it('accepts semesters inside the year', () => {
    const terms = [{ name: 'Odd', start: '2026-07-01', end: '2026-12-31' }];
    expect(academicYearDatesSchema.safeParse({ ...year, terms }).success).toBe(true);
  });

  it('rejects a year that ends before it starts, and semesters outside it', () => {
    expect(academicYearDatesSchema.safeParse({ startDate: '2027-01-01', endDate: '2026-01-01', terms: [] }).success).toBe(false);
    const terms = [{ name: 'Odd', start: '2026-06-01', end: '2026-12-31' }];
    expect(academicYearDatesSchema.safeParse({ ...year, terms }).success).toBe(false);
  });
});
