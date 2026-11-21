import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca un endpoint como accesible sin autenticación (el guard JWT es global y deniega por defecto). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
