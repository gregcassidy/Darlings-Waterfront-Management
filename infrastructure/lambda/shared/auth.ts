import { APIGatewayProxyEvent } from 'aws-lambda';

export interface UserContext {
  userId: string;
  name: string;
  email: string;
  role: 'admin' | 'employee';
  isGuest: boolean; // true for non-Azure AD users (manual submission)
}

export const getUserFromEvent = (event: APIGatewayProxyEvent): UserContext | null => {
  const context = event.requestContext?.authorizer;
  if (!context?.userId) return null;
  return {
    userId: context.userId,
    name: context.name,
    email: context.email,
    role: context.role as 'admin' | 'employee',
    isGuest: context.isGuest === 'true',
  };
};

export const isAdmin = (user: UserContext): boolean => user.role === 'admin';
