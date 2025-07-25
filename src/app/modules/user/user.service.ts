import { StatusCodes } from 'http-status-codes';
import { JwtPayload } from 'jsonwebtoken';
import { USER_ROLES } from '../../../enums/user';
import ApiError from '../../../errors/ApiError';
import { emailHelper } from '../../../helpers/emailHelper';
import { emailTemplate } from '../../../shared/emailTemplate';
import generateOTP from '../../../util/generateOTP';
import { IUser } from './user.interface';
import { User } from './user.model';
import QueryBuilder from '../../../builder/QueryBuilder';
import stripe from '../../config/stripe.config';
import { Post } from '../post/post.model';
import { Notification } from '../notification/notification.model';

const createUserToDB = async (payload: Partial<IUser>): Promise<IUser> => {
      //set role
      payload.role = USER_ROLES.USER;
      const createUser = await User.create(payload);
      if (!createUser) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create user');
      }

      //send email
      const otp = generateOTP();
      const values = {
            name: createUser.userName,
            otp: otp,
            email: createUser.email!,
      };
      const createAccountTemplate = emailTemplate.createAccount(values);
      emailHelper.sendEmail(createAccountTemplate);

      //save to DB
      const authentication = {
            oneTimeCode: otp,
            expireAt: new Date(Date.now() + 3 * 60000),
      };
      let stripeCustomer;
      try {
            stripeCustomer = await stripe.customers.create({
                  email: createUser.email,
                  name: createUser.userName,
            });
      } catch (error) {
            throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to create Stripe customer');
      }

      createUser.stripeCustomerId = stripeCustomer.id;
      await User.findOneAndUpdate(
            { _id: createUser._id },
            { $set: { authentication, stripeCustomerId: stripeCustomer.id } }
      );

      const updatedUser = await User.findById(createUser._id);
      const admin = await User.findOne({ role: USER_ROLES.SUPER_ADMIN, status: 'active' });

      const notification = await Notification.create({
            recipientRole: 'admin',
            title: "New User Registration",
            message: `A new user has been created: ${createUser.userName}`,
            type: 'info',
            recipient: admin!._id,
      });

      //@ts-ignore
      const io = global.io;

      if (io) {
            io.emit(`notification::admin`, notification);
      }
      return updatedUser as IUser;
};
const createAdminToDB = async (payload: Partial<IUser>): Promise<IUser> => {
      //set role
      payload.role = USER_ROLES.ADMIN;
      payload.verified = true;
      const createUser = await User.create(payload);
      if (!createUser) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create admin');
      }

      return createUser;
};

const getUserProfileFromDB = async (user: JwtPayload): Promise<Partial<IUser>> => {
      const { id } = user;
      const isExistUser = await User.isExistUserById(id);
      if (isExistUser?.status === 'delete') {
            throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
      }
      if (!isExistUser) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
      }

      return isExistUser;
};

const getAllUserFromDB = async (query: Record<string, any>) => {
      const userModal = new QueryBuilder(User.find({ role: USER_ROLES.USER, verified: true }), query)
            .search(['name', 'email'])
            .filter()
            .paginate()
            .sort()
            .fields();
      const allUsers = await userModal.modelQuery;

      const userIds = allUsers.map((user) => user._id);

      const postCounts = await Post.aggregate([
            {
                  $match: { author: { $in: userIds } },
            },
            {
                  $group: { _id: '$author', count: { $sum: 1 } },
            },
      ]);
      const meta = await userModal.countTotal();

      // Create a map for quick lookup of post counts by user ID
      const postCountMap = new Map(postCounts.map((item) => [item._id.toString(), item.count]));

      // Attach postCount to each user
      const usersWithPostCount = allUsers.map((user: any) => ({
            ...user.toObject(),
            postCount: postCountMap.get(user._id.toString()) || 0,
      }));

      return {
            data: usersWithPostCount,
            meta,
      };
};

const getAllAdminFromDB = async (query: Record<string, any>) => {
      const userModal = new QueryBuilder(User.find({ role: USER_ROLES.ADMIN, status: 'active' }), query)
            .search(['name', 'email'])
            .filter()
            .paginate()
            .sort()
            .fields();
      const data = await userModal.modelQuery;
      const meta = await userModal.countTotal();

      return {
            data,
            meta,
      };
};

const deleteAdminToDB = async (id: string) => {
      const result = await User.findOneAndDelete({ _id: id });

      if (!result) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Admin doesn't exist!");
      }

      return result;
};

const getUserByIdFromDB = async (id: string) => {
      const result = await User.findOne({ _id: id, status: 'active' });
      return result;
};

const updateProfileToDB = async (user: JwtPayload, payload: Partial<IUser>): Promise<Partial<IUser | null>> => {
      const { id } = user;

      console.log(id, payload);

      if (payload.email) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'Email cannot be changed!!!');
      }
      const isExistUser = await User.isExistUserById(id);
      if (!isExistUser) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
      }

      const updateDoc = await User.findOneAndUpdate({ _id: id }, payload, {
            new: true,
      });

      return updateDoc;
};

const deleteAccountFromDB = async (id: string, password: string) => {
      const isExistUser = await User.findById(id).select('+password');
      //check match password
      if (password && isExistUser && !(await User.isMatchPassword(password, isExistUser.password))) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is incorrect!');
      }

      const result = await User.findOneAndUpdate(
            { _id: id },
            {
                  $set: {
                        status: 'delete',
                  },
            },

            {
                  new: true,
            }
      );

      return result;
};
const updateStatusIntoDB = async (id: string, status: string) => {
      const result = await User.findOneAndUpdate(
            { _id: id },
            {
                  $set: {
                        status: status,
                  },
            },

            {
                  new: true,
            }
      );

      return result;
};

export const UserService = {
      createUserToDB,
      getUserProfileFromDB,
      updateProfileToDB,
      getAllUserFromDB,
      getUserByIdFromDB,
      deleteAccountFromDB,
      createAdminToDB,
      // createSuperAdminToDB,
      getAllAdminFromDB,
      updateStatusIntoDB,
      deleteAdminToDB,
};
