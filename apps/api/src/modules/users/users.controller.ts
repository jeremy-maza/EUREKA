import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common';
import { UserProfileDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Perfil del usuario autenticado' })
  @ApiOkResponse({ type: UserProfileDto })
  async me(@CurrentUser() current: AuthenticatedUser): Promise<UserProfileDto> {
    const user = await this.users.findById(current.id);
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return this.users.toProfile(user);
  }
}
