import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTeacherDto } from '../admin/dto/admin.dto';
import { AddStudentDto, CreateGroupDto, UpdateGroupDto } from './dto/group.dto';

const errorsOf = <T extends object>(cls: new () => T, plain: object): string[] =>
  validateSync(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true }).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('validación de DTOs de grupos y administración', () => {
  it('CreateTeacherDto rechaza cualquier campo `role` (el rol lo fija el servidor)', () => {
    const base = { email: 'profe@example.com', displayName: 'Profe', password: 'una-clave-larga' };
    expect(errorsOf(CreateTeacherDto, base)).toEqual([]);
    expect(errorsOf(CreateTeacherDto, { ...base, role: 'ADMIN' })).toContain(
      'property role should not exist',
    );
  });

  it('CreateTeacherDto valida correo y contraseña', () => {
    expect(
      errorsOf(CreateTeacherDto, { email: 'x', displayName: 'P', password: 'una-clave-larga' }),
    ).not.toEqual([]);
    expect(errorsOf(CreateTeacherDto, { email: 'a@b.co', displayName: 'P', password: 'corta' })).not.toEqual(
      [],
    );
  });

  it('CreateGroupDto exige nombre, recorta espacios y limita teacherIds', () => {
    expect(errorsOf(CreateGroupDto, { name: '   ' })).not.toEqual([]);
    expect(errorsOf(CreateGroupDto, { name: 'Grupo A' })).toEqual([]);
    expect(plainToInstance(CreateGroupDto, { name: '  Grupo A ' }).name).toBe('Grupo A');
    expect(errorsOf(CreateGroupDto, { name: 'G', teacherIds: ['no-uuid'] })).not.toEqual([]);
    const same = '0198a5c0-0000-7000-8000-000000000001';
    expect(errorsOf(CreateGroupDto, { name: 'G', teacherIds: [same, same] })).not.toEqual([]);
  });

  it('CreateGroupDto no acepta campos de estado ni auditoría', () => {
    expect(errorsOf(CreateGroupDto, { name: 'G', status: 'INACTIVE' })).toContain(
      'property status should not exist',
    );
    expect(errorsOf(UpdateGroupDto, { status: 'INACTIVE' })).toContain('property status should not exist');
  });

  it('AddStudentDto acepta studentId o email con formato válido', () => {
    expect(errorsOf(AddStudentDto, { studentId: '0198a5c0-0000-7000-8000-000000000001' })).toEqual([]);
    expect(errorsOf(AddStudentDto, { email: 'ana@example.com' })).toEqual([]);
    expect(errorsOf(AddStudentDto, { studentId: 'x' })).not.toEqual([]);
    expect(errorsOf(AddStudentDto, { email: 'no-es-correo' })).not.toEqual([]);
    expect(errorsOf(AddStudentDto, { userId: 'x' })).toContain('property userId should not exist');
  });
});
