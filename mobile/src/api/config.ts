/**
 * CloudBase 环境 ID。
 * 这是公开配置 —— SDK 初始化本来就会把它暴露在客户端，不是密钥。
 * 切勿把 SecretId / SecretKey / API 密钥写进这里或任何前端文件。
 */
export const CLOUDBASE_ENV_ID = 'cloud1-d1gc37qacf1fd1eee';

/** 团队内部邀请码集合（文档型数据库）。字段：code, active, note */
export const INVITE_COLLECTION = 'invite_codes';

/** 地点留话集合（文档型数据库）。文档 _id 对应 Place.id */
export const PLACES_COLLECTION = 'places';
