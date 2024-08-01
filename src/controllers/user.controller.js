import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js"
import { User } from "../models/user.models.js"
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";


const generateAccesAndRefreshToken = async(userId)=>{
    try {
        const user = await User.findOne(userId)
        const refreshToken = user.generateRefreshToken()
        const accessToken = user.generateAccessToken()
        user.refreshToken = refreshToken
        await user.save({validateBeforeSave: false})

        return {accessToken, refreshToken}

    } catch (error) {
        throw new ApiError(500, "something went wrong while generating refresh and access token")
    }
} 

const registerUser = asyncHandler( async(req, res) => {
    // get user details from frontend
    // validation - not empty
    // check if user already exist
    // check for images, check for avatar
    // upload them to cloudinary, avatar
    // create user object - create entry in db
    // remove password and refresh tokem field from response
    // check for user creation
    // return response
    
    const {fullName, email, username, password} = req.body
    console.log("email:", email);

    if (
        [fullName, email, username, password].some((field) => field?.trim()==="")
    ) {
        throw new ApiError(400, "All fields are required")
    }

    const existedUser = await User.findOne({
        $or: [{username}, {email}]
    })

    if (existedUser) {
        throw new ApiError(409, "User already exists, check username or email")
    }

    const avatarLocalPath = req.files?.avatar[0]?.path;
    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!avatar) {
        throw new ApiError(400, "avatar is required")
    }

    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select("-password -refreshToken")

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user")
    }

    return res.status(201).json(new ApiResponse(200, createdUser, "user registered succesfully"))


} )

const loginUser = asyncHandler (async(req, res)=>{
    // get data, check empty data
    //match username, email and password
    //access and refresh token
    //send cookie

    const {email, username, password} = req.body

    if (!username && !email){
        throw new ApiError(400, "username or email requried")
    }

    const user = await User.findOne({
        $or: [{username}, {email}]
    })

    if(!user){
        throw new ApiError(404, "user does not exist")
    }

    const isPaswordValid = await user.isPasswordCorrect(password)

    if(!isPaswordValid){
        throw new ApiError(401, "Password Incorrect")
    }

    const {accessToken, refreshToken} = await generateAccesAndRefreshToken(user._id)

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200).cookie("accessToken", accessToken, options).cookie("refreshToken", refreshToken, options).json(
        new ApiResponse(
            200,
            {
                user: loggedInUser, accessToken, refreshToken
            },
            "user loggin successfully")
    )

})

const logoutUser = asyncHandler(async(req, res)=>{
    await User.findByIdAndUpdate(req.user._id,
    {
        $set: {
            refreshToken: undefined
        }
    },
    {
        new: true
    })
    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options).json(
        new ApiResponse(200, {}, "user logged out succesfully!!")
    )
})

const refreshAccessToken = asyncHandler(async(req, res)=>{
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if (!incomingRefreshToken) {
        throw new ApiError(401, "unauthorized request")
    }

   try {
     const decodedToken = jwt.verify(
         incomingRefreshToken, 
         process.env.REFRESH_TOKEN_SECRET
     )
 
     const user = await User.findById(decodedToken?._id)
 
     if (!user) {
         throw new ApiError(401, "invalid refresh token")
     } 
 
     if (incomingRefreshToken !== user?.refreshToken){
         throw new ApiError(401, "refresh token is expired or used")
     }
 
     const options = {
         httpOnly: true,
         secure: true
     }
 
     const {accessToken, newRefreshToken} = await generateAccesAndRefreshToken(user._id)
 
     return res.status(200).cookie("accessToken", accessToken, options).cookie("refreshToken", newRefreshToken, options).json(
         new ApiResponse(200, {
             accessToken, refreshToken: newRefreshToken
         }, "access token refreshed")
     )
   } catch (error) {
        throw new ApiError(401, error?.message || "invalid refresh token")
   }

})

const changeCurrentPassword = asyncHandler(async(req, res)=>{
    const {oldPassword, newPassword} = req.body
    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if (!isPasswordCorrect){
        throw new ApiError(400, "invalid password")
    }

    user.password = newPassword
    await user.save({validateBeforeSave: false})
    
    return res.status(200).json(new ApiResponse(200, {}, "password changed succesfully"))
})

const getCurrentUser = asyncHandler(async(req, res)=>{
    return res.status(200).json(200, req.user, "current user fetched successfully")
})

const updateAccountDetails = asyncHandler(async(req, res)=>{
    const {fullName, email} = req.body

    if (!fullName || !email) {
        throw new ApiError(400, "all fields are requierd")
    }

    const user = await User.findByIdAndUpdate(req.user?._id, {
        $set:{
            fullName: fullName,
            email: email
        }
    },{new: true}).select("-password")

    return res.status(200).json(new ApiResponse(200, user, "account details updated succesfully"))


})

const updateUserCoverImage = asyncHandler(async(req, res)=>{
    const coverImageLocalPath = req.file?.path

    if(!coverImageLocalPath){
        throw new ApiError(400, "cover image file is missing")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url){
        throw new ApiError(400, "Error uploading while cover image")
    }

    let user = await User.findById(req.user?._id)
    
    user.coverImage = coverImage.url
    
    await user.save({validateBeforeSave: false}) 

    user = await user.select("-password")
    
    return res.status(200).json(new ApiResponse(200, user, "cover Image updated succesfully"))

})

const updateUserAvatar = asyncHandler(async(req, res)=>{
    const avatarLocalPath = req.file?.path

    if(!avatarLocalPath){
        throw new ApiError(400, "avatar file is missing")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError(400, "Error uploading while avatar")
    }

    const user = await User.findById(req.user?._id)
    
    user.avatar = avatar.url
    
    await user.save({validateBeforeSave: false}) 

    user = await user.select("-password")
    
    return res.status(200).json(new ApiResponse(200, user, "avatar updated succesfully"))

})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage
}