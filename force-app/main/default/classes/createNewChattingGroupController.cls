public with sharing class createNewChattingGroupController {
    @AuraEnabled
    public static Map<String, Object> searchUsers(String searchText) {
        Map<String, Object> result = new Map<String, Object>();

        try {
            if(String.isBlank(searchText)) throw new SearchException('검색어가 없습니다.');
            searchText = searchText.trim();

            User[] users = [SELECT Id, Name FROM User WHERE Name LIKE :('%'+searchText+'%') ORDER BY Name];
            UserData[] userDatas = new UserData[]{};

            for(User u : users) {
                userDatas.add(new UserData(u).setMark(searchText));
            }

            result.put('users', userDatas);
            result.put('state', 'SUCCESS');

        } catch (Exception e) {
            result.put('state', 'ERROR');
            result.put('message', e.getMessage()+' line: ['+e.getLineNumber()+']');
        }

        return result;
    }

    @AuraEnabled
    public static Map<String, Object> createChat(RecordData submitData) {
        Map<String, Object> result = new Map<String, Object>();
        Savepoint sp = Database.setSavepoint();
        try {
            ChattingGroup__c cg = new ChattingGroup__c();
            cg.Name = submitData.name;
            cg.Password__c = submitData.password;
            cg.Members__c = submitData.members;
            cg.IsPrivate__c = submitData.isPrivate;

            insert cg;

            ChatController.PermissionResult permisstionResult = ChatController.updateChatSharing(
                String.valueOf(cg.Id)
                , submitData.members == null ? new String[]{} : submitData.members.split(';')
            );
            if(permisstionResult.state == 'SUCCESS') {
                result.put('recordId', cg.Id);
                result.put('state', 'SUCCESS');
            } else throw new SharingException(permisstionResult.message);

        } catch (Exception e) {
            Database.rollback(sp);
            result.put('state', 'ERROR');
            result.put('message', e.getMessage()+' line: ['+e.getLineNumber()+']');
        }

        return result;
    }

    class SharingException extends Exception{}
    class SearchException extends Exception{}

    public class UserData {
        @AuraEnabled public String recordId {get;set;}
        @AuraEnabled public String name {get;set;}
        @AuraEnabled public String markerName {get;set;}
        @AuraEnabled public String photoUrl {get;set;}
        public UserData() {}
        public UserData(User u) {
            ConnectApi.Photo photo = ConnectApi.UserProfiles.getPhoto(System.Network.getNetworkId(), u.Id);
            this.photoUrl = photo.smallPhotoUrl;
            this.name = u.Name;
            this.recordId = u.Id;
        }
        
        public UserData setMark(String text) {
            String replaceTarget = '(?i)'+text;
            String marker = '<mark>$0</mark>';
            this.markerName = this.name.replaceAll(replaceTarget, marker);
            return this;
        }
    }

    public class RecordData {
        @AuraEnabled public String name {get;set;}
        @AuraEnabled public String password {get;set;}
        @AuraEnabled public String members {get;set;}
        @AuraEnabled public Boolean isPrivate {get;set;}
    }
}