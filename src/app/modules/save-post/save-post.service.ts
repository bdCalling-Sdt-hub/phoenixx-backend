import { ISavePost } from './save-post.interface';
import { SavePost } from './save-post.model';

const savePostToDB = async (payload: ISavePost) => {
      const isExist = await SavePost.findOne({
            userId: payload.userId,
            postId: payload.postId,
      });
      if (isExist) {
            await SavePost.findOneAndDelete({
                  userId: payload.userId,
                  postId: payload.postId,
            });
            return null;
      } else {
            const result = await SavePost.create(payload);
            return result;
      }
};

const getAllSavedPostsByUser = async (userId: string) => {
      const result = await SavePost.find({ userId: userId });
      const postIds = result.map((post) => post.postId);
      const result2 = await SavePost.find({ postId: { $in: postIds } }).populate({
            path: 'postId',
            select: '_id title images author category subCategory comments likes views',
            populate: [
                  {
                        path: 'author',
                        select: 'userName email profile',
                  },
                  {
                        path: 'category',
                        select: 'name',
                  },
                  {
                        path: 'subCategory',
                        select: 'name',
                  },
            ],
      });
      return result2;
};

export const SavePostService = {
      savePostToDB,
      getAllSavedPostsByUser,
};
