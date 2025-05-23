import { Types } from 'mongoose';

export type INotification = {
      recipient: Types.ObjectId;
      sender?: Types.ObjectId;
      type: 'info' | 'warning' | 'success' | 'error';
      recipientRole: 'admin' | 'user';
      message: string;
      link?: string;
      read: boolean;
};
