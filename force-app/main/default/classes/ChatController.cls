public with sharing class ChatController {
    @AuraEnabled
    public static InfoResult getChattingRoomInfo(String recordId) {
        InfoResult result = new InfoResult();

        try {
            ChattingGroup__c cg = [SELECT Id, Name, IsPrivate__c, Password__c, OwnerId, Owner.Name, Members__c FROM ChattingGroup__c WHERE Id = :recordId LIMIT 1];
            RoomInfo info = new RoomInfo(cg);

            result.state = 'SUCCESS';
            result.info = info;

        } catch (Exception e) {
            result.setError(e.getMessage() + ' line:['+e.getLineNumber()+']');
        }

        return result;
    }

    @AuraEnabled
    public static MessageResult getMessages(String recordId) {
        MessageResult result = new MessageResult();
        try {
            Chat__c[] chats = [SELECT Id, Content__c FROM Chat__c WHERE Group__c = :recordId ORDER BY CreatedDate DESC LIMIT 3];
            List<MessageModel> messages = new List<MessageModel>();
            Map<String, String> fileMap = new Map<String, String>();

            for(Chat__c c : chats) {
                List<MessageModel> messageList = c.Content__c == null 
                                               ? new List<MessageModel>()
                                               : (List<MessageModel>)JSON.deserialize(c.Content__c, List<MessageModel>.class);
                messages.addAll(messageList);
            }

            for(MessageModel mm : messages) {
                if(mm.type == MessageType.FILE.name()) mm.message = getDocumentUrl(mm.message);
            }

            result.state = 'SUCCESS';
            result.messages = JSON.serialize(messages);
        } catch (Exception e) {
            result.setError(e.getMessage() + ' line:['+e.getLineNumber()+']');
        }
        return result;
    }

    @AuraEnabled
    public static MessageResult getRealtimeMessage(String recordId, String key) {
        MessageResult result = new MessageResult();
        try {
            Chat__c[] chats = [SELECT Id, Content__c FROM Chat__c WHERE Group__c = :recordId ORDER BY LastModifiedDate DESC LIMIT 1];
            for(Chat__c c : chats) {
                List<MessageModel> messageInfo = (List<MessageModel>)JSON.deserialize(c.Content__c, List<MessageModel>.class);
                for(MessageModel m : messageInfo) {
                    if(m.key == Integer.valueOf(key)) {
                        result.messages = JSON.serialize(m);
                        break;
                    }
                }
            }
            result.state = 'SUCCESS';
        } catch (Exception e) {
            result.setError(e.getMessage() + ' line:['+e.getLineNumber()+']');
        }
        return result;
    }

    @AuraEnabled
    public static MessageResult getRealtimeFile(String recordId, String key){
        MessageResult result = new MessageResult();
        try {
            Chat__c[] chats = [SELECT Id, Content__c FROM Chat__c WHERE Group__c = :recordId ORDER BY LastModifiedDate DESC LIMIT 1];
            MessageModel fileMessage;
            for(Chat__c c : chats) {
                List<MessageModel> messageInfo = (List<MessageModel>)JSON.deserialize(c.Content__c, List<MessageModel>.class);
                for(MessageModel m : messageInfo) {
                    if(m.key == Integer.valueOf(key)) {
                        fileMessage = m;
                        break;
                    }
                }
            }

            if(String.isNotBlank(fileMessage.message)) fileMessage.message = getDocumentUrl(fileMessage.message);

            result.messages = JSON.serialize(fileMessage);
            result.state = 'SUCCESS';
        } catch (Exception e) {
            result.setError(e.getMessage() + ' line:['+e.getLineNumber()+']');
        }
        return result;
    }

    @AuraEnabled
    public static CreateMessageResult createMessage(String recordId, String message, Boolean isNotification) {
        CreateMessageResult result = new CreateMessageResult();

        try {
            MessageModel newMessage = new MessageModel(message, isNotification);
            Chat__c chat = getChatRecord(recordId, newMessage);

            upsert chat;

            if(!isNotification) {
                ChatMessage__e cme = new ChatMessage__e(
                    ChatId__c = recordId
                    , Key__c = newMessage.key
                    , Type__c = 'MESSAGE'
                );
                System.EventBus.publish(cme);
            }

            result.state = 'SUCCESS';
            result.recordId = chat.Id;
            result.newMessage = JSON.serialize(newMessage);

        } catch (Exception e) {
            result.setError(e.getMessage() + ' line:['+e.getLineNumber()+']');
        }

        return result;
    }

    @AuraEnabled
    public static CreateMessageResult createFileMessage(String recordId, FileInfo file) {
        CreateMessageResult result = new CreateMessageResult();
        Savepoint sp = Database.setSavepoint();
        try {
            Id folderId = [SELECT Id FROM Folder WHERE DeveloperName = 'ChattingFolder' LIMIT 1]?.Id;
            Document document = new Document();
            document.Name       = file.name;
            document.Type       = file.type;
            document.Body       = EncodingUtil.base64Decode(file.data.split('base64,')[1]);
            document.IsPublic   = true;
            document.FolderId   = folderId;
            insert document;

            file.data = document.Id;

            MessageModel newMessage = new MessageModel(file);
            Chat__c chat = getChatRecord(recordId, newMessage);

            upsert chat;

            newMessage.message = getDocumentUrl(newMessage.message);

            ChatMessage__e cme = new ChatMessage__e(
                ChatId__c = recordId
                , Key__c = newMessage.key
                , Type__c = 'MESSAGE_FILE'
            );
            System.EventBus.publish(cme);

            result.state = 'SUCCESS';
            result.recordId = chat.Id;
            result.newMessage = JSON.serialize(newMessage);
        } catch (Exception e) {
            Database.rollback(sp);
            result.setError(e.getMessage() + ' line:['+e.getLineNumber()+']');
        }
        return result;
    }

    private static Chat__c getChatRecord(String recordId, MessageModel newMessage) {
        List<Chat__c> chats = [SELECT Id, Content__c FROM Chat__c WHERE Group__c = :recordId ORDER BY CreatedDate DESC LIMIT 1];
        List<MessageModel> messageList;
        Chat__c chat;

        if(chats.isEmpty()) {
            messageList     = new List<MessageModel>();
            chat            = new Chat__c();
            chat.Group__c   = recordId;
        } else {
            messageList = chats[0].Content__c == null
                        ? new List<MessageModel>()
                        : (List<MessageModel>)JSON.deserialize(chats[0].Content__c, List<MessageModel>.class);
            chat = chats[0];
        }

        messageList.add(newMessage);

        if(chat.Id != null && chat.Content__c?.length() > 131072) {
            List<MessageModel> newMessages = new List<MessageModel>{messageList[messageList.size()-1]};
            chat.Id = null;
            chat.Content__c = JSON.serialize(newMessages);
        } else chat.Content__c = JSON.serialize(messageList);

        return chat;
    }

    @AuraEnabled
    public static MemberResult updateChatMembers(String recordId, String memberIds, Boolean isInvite) {
        MemberResult result = new MemberResult();
        Savepoint sp = Database.setSavepoint();
        try {
            ChattingGroup__c chat = [SELECT Id, Members__c, OwnerId FROM ChattingGroup__c WHERE Id = :recordId LIMIT 1];
            List<String> oldMembers = chat.Members__c != null ? chat.Members__c.split(';') : new List<String>();
            List<String> newMembers = memberIds.split(';');
            String userQuery = 'SELECT Id, Name FROM User WHERE Id IN';

            if(isInvite) {
                for(String mem : oldMembers) {
                    if(newMembers.contains(mem)) newMembers.remove(newMembers.indexOf(mem));
                }
                userQuery += ':newMembers';
            } else {
                for(String mem : newMembers) {
                    if(oldMembers.contains(mem)) oldMembers.remove(oldMembers.indexOf(mem));
                }
                userQuery += ':oldMembers';
            }

            chat.Members__c = memberIds;

            update chat;
            
            PermissionResult permissionResult = updateChatSharing(recordId, memberIds.split(';'));

            if(PermissionResult.state != 'SUCCESS') throw new PermissionException(PermissionResult.message);

            User[] users = Database.query(userQuery);
            List<String> memberNames = new List<String>();

            for(User u : users) {
                memberNames.add(u.Name);
            }

            String notiMessage = String.join(memberNames, ',')
                               + ' 님이 '
                               + (isInvite ? '입장하셨습니다.' : '퇴장하셨습니다.');
            CreateMessageResult messageResult = createMessage(recordId, notiMessage, true);

            if(messageResult.state != 'SUCCESS') throw new PermissionException(messageResult.message);

            MessageModel mm = (MessageModel)JSON.deserialize(messageResult.newMessage, MessageModel.class);
            ChatMessage__e cm = new ChatMessage__e(
                Members__c = memberIds
                , Type__c = (isInvite ? 'NEW_MEMBER' : 'OUT_MEMBER')
                , ChatId__c = recordId
                , Key__c = mm.key
            );
            System.EventBus.publish(cm);

            result.members = getMemberInfo(chat.Members__c);
            result.notiMessage = messageResult.newMessage;
            result.state = 'SUCCESS';

        } catch (Exception e) {
            Database.rollback(sp);
            result.setError(e.getMessage() + ' line:['+e.getLineNumber()+']');
        }

        return result;
    }

    @AuraEnabled
    public static MemberResult getRealtimeMembers(String memberIds) {
        MemberResult result = new MemberResult();
        try {
            result.members = getMemberInfo(memberIds);
            result.state = 'SUCCESS';
        } catch (Exception e) {
            result.setError(e.getMessage() + ' line:['+e.getLineNumber()+']');
        }
        return result;
    }

    @AuraEnabled
    public static ExitChatResult doExitChat(String recordId, String memberId, Boolean isOwner) {
        ExitChatResult result = new ExitChatResult();
        try {
            if(isOwner) delete new ChattingGroup__c(Id = recordId);
            else {
                ChattingGroup__c chat = [SELECT Id, Members__c FROM ChattingGroup__c WHERE Id = :recordId LIMIT 1];
                List<String> members = chat.Members__c.split(';');

                if(members.contains(memberId)) members.remove(members.indexOf(memberId));

                MemberResult memResult = updateChatMembers(recordId, String.join(members, ';'), false);
                if(memResult.state != 'SUCCESS') throw new PermissionException(memResult.message);
            }
            result.state = 'SUCCESS';
        } catch (Exception e) {
            result.setError(e.getMessage()+' line:['+e.getLineNumber()+']');
        }
        return result;
    }

    public static PermissionResult updateChatSharing(String recordId, String[] members) {
        PermissionResult result = new PermissionResult();
        ChattingGroup__c cg = [SELECT Id, OwnerId FROM ChattingGroup__c WHERE Id = :recordId LIMIT 1];

        if(members.contains(cg.OwnerId)) members.remove(members.indexOf(cg.OwnerId));

        ChattingGroup__share[] cgs = [SELECT Id, UserOrGroupId, AccessLevel, RowCause FROM ChattingGroup__share WHERE ParentId = :recordId AND RowCause != 'Owner'];
        Savepoint sp = Database.setSavepoint();

        try {
            if(!cgs.isEmpty()) delete cgs;

            ChattingGroup__share[] newCgs = new ChattingGroup__share[]{};

            for(String member : members) {
                ChattingGroup__share share = new ChattingGroup__share(
                    ParentId = recordId
                    , UserOrGroupId = member
                    , AccessLevel = 'Edit'
                    , RowCause = Schema.ChattingGroup__Share.RowCause.Manual
                );
                newCgs.add(share);
            }

            if(!newCgs.isEmpty()) insert newCgs;

            result.state = 'SUCCESS';

        } catch (Exception e) {
            Database.rollback(sp);
            result.setError(e.getMessage() + ' line:['+e.getLineNumber()+']');
        }
        
        return result;
    }

    private static List<Map<String, String>> getMemberInfo(String members) {
        List<Map<String, String>> result = new List<Map<String, String>>();
        String[] memberList = members.split(';');
        User[] users = [SELECT Id, Name FROM User WHERE Id IN :memberList];
        for(User u : users) {
            Map<String, String> memberMap = new Map<String, String>{
                'recordId' => u.Id
                , 'name' => u.Name
                , 'photoUrl' => getProfilePhotoUrl(u.Id)
            };
            result.add(memberMap);
        }
        return result;
    }

    private static String getProfilePhotoUrl(String userId) {
        ConnectApi.Photo photo = ConnectApi.UserProfiles.getPhoto(System.Network.getNetworkId(), userId);
        return photo.smallPhotoUrl;
    }

    private static String getDocumentUrl(String reecordId) {
        String baseUrl = System.Url.getOrgDomainUrl().toExternalForm();
        String orgId = UserInfo.getOrganizationId();
        return String.format('{0}/servlet/servlet.ImageServer?id={1}&oid={2}', new String[]{baseUrl, reecordId, orgId});
    }

    class PermissionException extends Exception{}

    virtual public class Result {
        @AuraEnabled public String state {get;set;}
        @AUraEnabled public String message {get;set;}

        public void setError(String message) {
            this.state = 'ERROR';
            this.message = message;
        }
    }

    public class InfoResult extends Result {
        @AuraEnabled public RoomInfo info {get;set;}
    }

    public class CreateMessageResult extends Result {
        @AuraEnabled public String recordId {get;set;}
        @AuraEnabled public String newMessage {get;set;}
    }

    public class MessageResult extends Result {
        @AuraEnabled public String messages {get;set;}
    }

    public class MemberResult extends Result {
        @AuraEnabled public List<Map<String, String>> members {get;set;}
        @AuraEnabled public String notiMessage {get;set;}
    }

    public class PermissionResult extends Result {}

    public class ExitChatResult extends Result {}

    public class RoomInfo {
        @AuraEnabled public String recordId {get;set;}
        @AuraEnabled public String name {get;set;}
        @AuraEnabled public String owner {get;set;}
        @AuraEnabled public String ownerId {get;set;}
        @AuraEnabled public String password {get;set;}
        @AuraEnabled public String userName {get;set;}
        @AuraEnabled public String userId {get;set;}
        @AuraEnabled public String photoUrl {get;set;}
        @AuraEnabled public Integer totalMemberCount {get;set;}
        @AuraEnabled public Boolean isPrivate {get;set;}
        @AuraEnabled public List<Map<String, String>> members {get;set;}
        public RoomInfo(ChattingGroup__c cg) {
            this.recordId = cg.Id;
            this.name = cg.Name;
            this.owner = cg.Owner.Name;
            this.ownerId = cg.OwnerId;
            this.password = cg.Password__c;
            this.userId = UserInfo.getUserId();
            this.isPrivate = cg.IsPrivate__c;
            this.photoUrl = getProfilePhotoUrl(this.userId);
            
            if(cg.Members__c == null || !cg.Members__c.contains(cg.OwnerId)) cg.Members__c = cg.OwnerId + ';' + cg.Members__c;

            this.members = getMemberInfo(cg.Members__c);
            this.totalMemberCount = this.members.size();

            User currentUser = [SELECT Name FROM User WHERE Id = :this.userId LIMIT 1];
            this.userName = currentUser.Name;
        }
    }

    public class FileInfo {
        @AuraEnabled public String name {get;set;}
        @AuraEnabled public String type {get;set;}
        @AuraEnabled public String data {get;set;}
        public FileInfo() {}
        public FileInfo(String name, String type, String data) {
            this.name = name;
            this.type = type;
            this.data = data;
        }
    }

    enum MessageType { MESSAGE, FILE }

    public class MessageModel {
        @AuraEnabled public Decimal key {get;set;}
        @AuraEnabled public String message {get;set;}
        @AuraEnabled public String type {get;set;}
        @AuraEnabled public String hour {get;set;}
        @AuraEnabled public String min {get;set;}
        @AuraEnabled public String createdById {get;set;}
        @AuraEnabled public Boolean isNotification {get;set;}
        @AuraEnabled public Datetime createdDate {get;set;}

        public MessageModel(String message) {
            this.setData(message, MessageType.MESSAGE.name(), false);
        }
        
        public MessageModel(String message, Boolean isNotification){
            this.setData(message, MessageType.MESSAGE.name(), isNotification);
        }

        public MessageModel(FileInfo file) {
            this.setData(file.data, MessageType.FILE.name(), false);
        }

        public void setData(String message, String messageType, Boolean isNotification) {
            Datetime now = Datetime.now();
            String nowStr = now.format('HHmmssSSS');
            Integer mm = now.minute();
            Integer ss = now.second();
            Integer mss = now.millisecond();

            this.key = mm*60*1000 + ss*1000 + mss;
            this.message = message;
            this.type = messageType;
            this.hour = nowStr.substring(0, 2);
            this.min = nowStr.substring(2, 4);
            this.createdDate = now;
            this.createdById = isNotification ? 'NULL' : UserInfo.getUserId();
            this.isNotification = isNotification;
        }
    }
}