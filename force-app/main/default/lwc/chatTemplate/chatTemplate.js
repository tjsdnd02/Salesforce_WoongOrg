import { LightningElement, track, api } from 'lwc';
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { NavigationMixin } from 'lightning/navigation';
import { subscribe, unsubscribe, onError, setDebugFlag, isEmpEnabled } from 'lightning/empApi';
import woongChatIcon from '@salesforce/resourceUrl/WoongChatIcon';

import MemberCheckModal from 'c/memberCheckModal';

import getChattingRoomInfo from '@salesforce/apex/ChatController.getChattingRoomInfo';
import getMessages from '@salesforce/apex/ChatController.getMessages';
import createMessage from '@salesforce/apex/ChatController.createMessage';
import getRealtimeMessage from '@salesforce/apex/ChatController.getRealtimeMessage';
import updateChatMembers from '@salesforce/apex/ChatController.updateChatMembers';
import getRealtimeMembers from '@salesforce/apex/ChatController.getRealtimeMembers';
import doExitChat from '@salesforce/apex/ChatController.doExitChat';
import createFileMessage from '@salesforce/apex/ChatController.createFileMessage';
import getRealtimeFile from '@salesforce/apex/ChatController.getRealtimeFile';

import searchUsers from '@salesforce/apex/createNewChattingGroupController.searchUsers';

export default class ChatTemplate extends NavigationMixin(LightningElement) {
    @api recordId;

    @track isSending = false;
    @track isFail = false;
    @track isLoading = false;
    @track isCheckMember = false;
    @track isShowMembers = false;
    @track isSearchUser = false;
    @track isNotMe = false;
    @track info = {};
    @track messageModel = {};
    @track memberMap = {};
    @track subscription = {};
    @track contents = [];
    @track searchUsers = [];
    @track selectUsers = [];

    get maxCount() {
        return 10 - ( this.info?.members?.length ? this.info.members.length : 0 );
    }

    get hasNotContents() {
        return this.isLoading ? false : this.contents.length < 1;
    }

    get isMyRoom() {
        return this.info.ownerId == this.info.userId;
    }
    
    async connectedCallback() {
        try {
            const recordId = this.recordId;
            const result = await getChattingRoomInfo({recordId});
            const { info, state , message } = result;
            if(state == 'SUCCESS') {
                this.info = info;
                await this.createCheckModal(info);
                await this.subscribeChatting();
                setTimeout(() => {
                    this.bodyScrollBottom();
                }, 1000);
            } else {
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: '채팅방을 불러오지 못했습니다.'
                        , message: message
                        , variant: "error"
                    })
                );
            }
        } catch (error) {
            console.error(error);
        }
    }

    async handleExitClick() {
        const confirmMessage = this.isMyRoom
                             ? `${this.info.userName} 님은 채팅방 소유자 입니다.\n확인을 누르면 채팅방과 채팅 내역이 삭제됩니다.`
                             : '확인을 누르면 채팅방을 나가게 됩니다.\n다시 들어오고 싶을 땐 채팅방 맴버에게 초대를 받아야 합니다.';
        if(confirm(confirmMessage)) {
            try {
                const result = await doExitChat({
                    recordId: this.recordId
                    , memberId: this.info.userId
                    , isOwner: this.isMyRoom
                });
                if(result.state == 'SUCCESS') {
                    alert('즐거운 채팅이 되었나요? 해당 채팅방에서 퇴장합니다.\n안녕히가세요. ^___^');
                    this[NavigationMixin.Navigate]({
                        type: 'standard__objectPage',
                        attributes: {
                            objectApiName: 'ChattingGroup__c',
                            actionName: 'home'
                        }
                    });
                } else {
                    console.error(result.message);
                }
            } catch (error) {
                console.error(error);
            }
        }
    }

    handleMemberClick() {
        this.isShowMembers = !this.isShowMembers;
        this.isSearchUser = this.isShowMembers ? this.isSearchUser : false;

        const memberListContainer = this.template.querySelector('.member-list-container');
        if(this.isShowMembers) memberListContainer.classList.add('is-open');
        else memberListContainer.classList.remove('is-open');
    }

    handleAddButtonClick() {
        this.isSearchUser = !this.isSearchUser;
    }

    async handleSearchKeyup(e) {
        const value = e.currentTarget.value;
        if(!value) return;
        if(e.key == 'Enter') {
            try {
                const result = await searchUsers({searchText: value});
                const { users, state, message } = result;
                if(state == 'SUCCESS') {
                    this.searchUsers = users;
                } else {
                    this.dispatchEvent(
                        new ShowToastEvent({
                            title: '사용자 검색을 실패했습니다.'
                            , message: message
                            , variant: "error"
                        })
                    );
                }
            } catch (error) {
                console.error(error);
            }
        }
    }

    @track isHoverMenu = false;
    handleContext(e) {
        const cTarget = e.currentTarget;
        const recordId = e.currentTarget.dataset.recordid;

        this.isNotMe = recordId != this.info.userId;

        cTarget.addEventListener('contextmenu', e => e.preventDefault());

        if(!this.isHoverMenu)this.closeContentMenu();
        if(e.which == 3) {
            if(e.currentTarget.childNodes[2].childNodes[0].classList.contains('hide')) {
                e.currentTarget.childNodes[2].childNodes[0].classList.remove('hide');
            }
        }
    }
    handleContextmenuEnter() {
        this.isHoverMenu = true;
    }
    handleContextmenuLeave() {
        this.isHoverMenu = false;
    }

    async handleExit(e) {
        const value = e.currentTarget.parentNode.parentNode.parentNode.dataset.recordid;
        if(confirm('사용자를 퇴장시키겠습니까?\n퇴장을 시켜도 언제든 다시 초대할 수 있습니다. ^___^')) {
            const members = [];
            this.info.members.forEach((e) => {
                if(e.recordId != value) members.push(e.recordId);
            });
            const result = await updateChatMembers({
                recordId: this.recordId
                , memberIds: members.join(';')
                , isInvite: false
            });
            if(result.state == 'SUCCESS') {
                const memberMap = {};
                result.members.forEach((e) => memberMap[e.recordId] = {photoUrl: e.photoUrl, name: e.name});
                this.memberMap = memberMap;
                this.info.members = result.members;
                this.info.totalMemberCount = result.members.length;
                this.contents.push(JSON.parse(result.notiMessage));
            } else {
                console.error(result.message);
            }
        }
    }

    handleSelectUser(e) {
        if(this.selectUsers.length == this.maxCount) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: '채팅방 맴버는 최대 10명 까지 가능합니다.'
                    , variant: "WARNING"
                })
            );
            return;
        }

        const value = e.currentTarget.dataset.recordid;

        const oldMembers = this.info.members.filter((e) => {return e.recordId == value});
        if(oldMembers.length > 0) return;

        const hasSelectedItem = this.selectUsers.filter((v) => {return v.key == value});
        if(hasSelectedItem.length > 0) return;
        
        const selectItem = this.searchUsers.filter((v,idx) => {return v.recordId == value})[0];
        this.selectUsers.push({
            type: 'avatar'
            , label: selectItem.name
            , src: selectItem.photoUrl
            , fallbackIconName: 'standard:user'
            , variant: 'circle'
            , alternativeText: 'User avatar'
            , key: selectItem.recordId
        });
    }

    handleItemRemove(e) {
        const idx = e.detail.index;
        this.selectUsers.splice(idx, 1);
    }

    async handleInvite() {
        if(this.selectUsers.length == 0) return;

        const memberIds = new Set();
        this.selectUsers.forEach((e) => memberIds.add(e.key));
        this.info.members.forEach((e) => memberIds.add(e.recordId));

        try {
            const result = await updateChatMembers({
                recordId: this.recordId
                , memberIds: [...memberIds].join(';')
                , isInvite: true
            });
            const { state, message, members, notiMessage } = result;
            if(state == 'SUCCESS') {
                const memberMap = {};

                members.forEach((e) => memberMap[e.recordId] = {photoUrl: e.photoUrl, name: e.name});

                this.memberMap = memberMap;
                this.info.members = members;
                this.info.totalMemberCount = members.length;
                this.contents.push(JSON.parse(notiMessage));
                this.isSearchUser = false;
                this.selectUsers = [];
                this.searchUsers = [];
            } else {
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: '초대를 실패했습니다.'
                        , message
                        , variant: "error"
                    })
                );
            }
        } catch(error) {
            console.error(error);
        }
    }

    async handleKeyup(e) {
        e.preventDefault();
        const value = e.currentTarget.value;
        if(!value) return;
        if(e.key == 'Enter' && !e.shiftKey) {
            // const message = value.replaceAll('\n', '');
            const message = value;
            e.currentTarget.value = message;
            if(!message) return;
            this.createNewMessage(message);
        }
    }

    handleClick() {
        const input = this.template.querySelector('.message-input');
        const value = input.value;
        this.createNewMessage(value);
    }

    // [S] 이미지 or 비디오 파일 보내기
    @track fileName = '';
    @track fileUrl = '';
    @track fileBlob = new Blob();
    get isShowPreview() {
        return this.fileUrl ? true : false;
    }
    get isImg() {
        return /(.*?)\.(jpg|jpeg|png|gif|bmp)$/.test(this.fileName);
    }
    get fileType() {
        return this.fileName.split('.')[1];
    }

    async handlePaste(e) {
        let blob;
        const pasteItem = e.clipboardData.items[0];
        if(pasteItem.type.includes('image') || pasteItem.type.includes('video')) {
            blob = pasteItem.getAsFile();
            this.fileName = blob.name;
        } else {
            const clipContents = await navigator.clipboard.read();
            for (let clipboardItem of clipContents) {
                for (let type of clipboardItem.types) {
                    if(type.includes('image')) {
                        blob = await clipboardItem.getType(type);
                        this.fileName = `클립보드 이미지.${type.split('/')[1]}`;
                    }
                }
            }
        }
        this.fileUrl = blob ? URL.createObjectURL(blob) : '';
        this.fileBlob = blob;
    }

    async handleFileSubmit() {
        const reader = new FileReader();
        reader.onload = async () => {
            this.isFileSending = true;
            const file = {
                name: this.fileName
                , type: this.fileType
                , data: reader.result
            };
            const result = await createFileMessage({recordId: this.recordId, file});
            if(result.state == 'SUCCESS') {
                const newMessage = JSON.parse(result.newMessage);
                newMessage.HHmm = `${newMessage.hour}:${newMessage.min}`;
                newMessage.photoUrl = this.info.photoUrl;
                newMessage.isMyMessage = newMessage.createdById == this.info.userId;
                newMessage.name = this.info.userName;
                newMessage.isImg = true;
                this.contents.push(newMessage);
                this.handleClosePreview();
                setTimeout(() => {
                    this.bodyScrollBottom();
                }, 1000);
            }
            this.isFileSending = false;
        }
        reader.readAsDataURL(this.fileBlob);

        // const imgElement = document.createElement('img');
        // imgElement.src = this.fileUrl;

        // const canvas = document.createElement('canvas');
        // const ctx = canvas.getContext('2d');

        // ctx.drawImage(imgElement, 0, 0);

        // const base64 = canvas.toDataURL();
        // const file = {
        //     name: this.fileName
        //     , type: this.fileType
        //     , data: base64
        // };
        
        // this.isFileSending = true;
        // try {
        //     const result = await createFileMessage({recordId: this.recordId, file});
        //     console.log('result: ', result);
        //     if(result.state == 'SUCCESS') {
        //         const newMessage = JSON.parse(result.newMessage);
        //         newMessage.HHmm = `${newMessage.hour}:${newMessage.min}`;
        //         newMessage.photoUrl = this.info.photoUrl;
        //         newMessage.isMyMessage = newMessage.createdById == this.info.userId;
        //         newMessage.name = this.info.userName;
        //         newMessage.isImg = true;
        //         this.contents.push(newMessage);
        //         this.handleClosePreview();
        //         setTimeout(() => {
        //             this.bodyScrollBottom();
        //         }, 1000);
        //     }
        // } catch (error) {
        //     console.error(error);
        // }
        // this.isFileSending = false;
    }

    handleClosePreview() {
        this.fileName = '';
        this.fileUrl = '';
    }
    // [E]

    async createCheckModal(info) {
        const modalResult = await MemberCheckModal.open({
            size:
             'medium'
            , info
        });
        this.isCheckMember = modalResult == 'SUCCESS';
        if(this.isCheckMember) this.getChatMessages();
        else {
            this.dispatchEvent(
                new ShowToastEvent({
                    title:      !modalResult ? '사용자 확인을 완료하지 못했습니다.' : '채팅방 맴버가 아닙니다.'
                    , message:  !modalResult ? '확인이 끝나기 전에 창을 닫지 말아주세요.' : '채팅방 소유자에게 초대를 요청하세요.'
                    , variant:  !modalResult ? "error" : "WARNING"
                })
            );
            this[NavigationMixin.Navigate]({
                type: 'standard__objectPage',
                attributes: {
                    objectApiName: 'ChattingGroup__c',
                    actionName: 'home'
                }
            });
        }
    }

    async getChatMessages() {
        this.isLoading = true;
        const messageResult = await getMessages({recordId: this.recordId});
        const { messages, state, message } = messageResult;
        if(state == 'SUCCESS') {
            this.contents = JSON.parse(messages);

            const memberMap = {};
            this.info.members.forEach((e) => {
                memberMap[e.recordId] = {photoUrl: e.photoUrl, name: e.name};
            });
            this.contents.forEach((e) => {
                e.HHmm = `${e.hour}:${e.min}`;
                e.isMyMessage = e.createdById == this.info.userId
                e.photoUrl = memberMap[e.createdById]?.photoUrl;
                e.name = memberMap[e.createdById]?.name;
                e.isImg = e.type == 'FILE';
            });
            this.memberMap = memberMap;
        } else {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: '채팅 내용을 불러오지 못했습니다.'
                    , message: message
                    , variant: "error"
                })
            );
        }
        this.isLoading = false;
        setTimeout(() => {
            this.bodyScrollBottom();
        }, 1000);
    }

    async createNewMessage(message) {
        message = message.trim();
        if(!message) return;

        const recordId = this.recordId;

        this.createNewMessageInfo(message);
        this.clearMessageInput();
        this.isSending = true;

        try {
            const result = await createMessage({recordId, message, isNotification: false});
            this.isFail = result.state == 'SUCCESS';
            if(result.state == 'SUCCESS') {
                const newMessage = JSON.parse(result.newMessage);
                newMessage.HHmm = `${newMessage.hour}:${newMessage.min}`;
                newMessage.photoUrl = this.info.photoUrl;
                newMessage.isMyMessage = newMessage.createdById == this.info.userId;
                newMessage.name = this.info.userName;
                newMessage.isImg = false;
                this.contents.push(newMessage);
            } else {
                
            }
            this.isSending = false;
            this.clearNewMessage();
            this.bodyScrollBottom();
        } catch(error) {
            console.error(error);
        }
    }

    createNewMessageInfo(message) {
        const now = new Date();
        this.messageModel.HHmm = `${now.getHours()}:${now.getMinutes().toString().length > 1 ? now.getMinutes() : `0${now.getMinutes()}`}`;
        this.messageModel.message = message;
        this.messageModel.name = this.info.userName;
        this.messageModel.photoUrl = this.info.photoUrl;
        this.messageModel.isMyMessage = true;
    }

    clearNewMessage() {
        this.messageModel = {};
    }

    clearMessageInput() {
        const input = this.template.querySelector('.message-input');
        input.value = '';
    }

    bodyScrollBottom() {
        const contentBody = this.template.querySelector('.content-container');
        contentBody.scrollTop = contentBody.scrollHeight;
    }

    closeContentMenu() {
        this.template.querySelectorAll('.list-body .button-container ul').forEach(el => {
            if(!el.classList.contains('hide')) {
                el.classList.add('hide');
            }
        });
    }

    newMessageNotification(message) {
        if(Notification.permission === "denied" || Notification.permission === "default") {
            console.warn('브라우저 알림이 차단되어있습니다. 알림 권한을 허용해주세요.');
        } else {
            const noti = new Notification('웅채팅 새로운 메세지', {body: message, icon: woongChatIcon});
            setTimeout(() => {Notification.close.bind(noti)}, 3000);
        }
    }

    async subscribeChatting() {
        this.registerErrorListener();
        const channelName = '/event/ChatMessage__e';
        const recordId = this.recordId;
        const currentUserId = this.info.userId;
        const subResult = await subscribe(channelName, -1, async (res) => {
            const {
                channel
                , data: { 
                    payload: { 
                        ChatId__c
                        , Key__c
                        , CreatedById 
                        , Type__c
                        , Members__c
                    } 
                } 
            } = res;
            console.log('res: ', res);
            const isMyRoomEvent = ChatId__c == recordId && channel == channelName;

            if(Type__c == 'NEW_MEMBER' || Type__c == 'OUT_MEMBER') {
                if(isMyRoomEvent && CreatedById != currentUserId) {
                    const result = await getRealtimeMembers({memberIds: Members__c});
                    if(result.state == 'SUCCESS') {
                        const memberMap = {};
                        result.members.forEach((e) => memberMap[e.recordId] = {photoUrl: e.photoUrl, name: e.name});
                        this.memberMap = memberMap;
                        this.info.members = result.members;
                        this.info.totalMemberCount = result.members.length;
                        
                        const notiResult = await getRealtimeMessage({recordId, key: Key__c});
                        if(notiResult.state == 'SUCCESS') {
                            this.contents.push(JSON.parse(notiResult.messages));
                        }
                        setTimeout(() => {
                            this.bodyScrollBottom();
                        }, 700);
                    }
                }
            } else if(Type__c == 'MESSAGE') {
                if(isMyRoomEvent && CreatedById != currentUserId) {
                    const result = await getRealtimeMessage({recordId, key: Key__c});
                    if(result.state == 'SUCCESS') {
                        const message = JSON.parse(result.messages);
    
                        message.HHmm = `${message.hour}:${message.min}`;
                        message.photoUrl = this.info.photoUrl;
                        message.isMyMessage = false;
                        message.photoUrl = this.memberMap[message.createdById]?.photoUrl;
                        message.name = this.memberMap[message.createdById]?.name;
                        message.isImg = false;
                        console.log('message: ', message);
    
                        this.contents.push(message);
                        this.newMessageNotification(`${message.name}: ${message.message}`);
                        setTimeout(() => {
                            this.bodyScrollBottom();
                        }, 700);
                    }
                }
            } else if(Type__c == 'MESSAGE_FILE') {
                if(isMyRoomEvent && CreatedById != currentUserId) {
                    const result = await getRealtimeFile({recordId, key: Key__c});
                    if(result.state == 'SUCCESS') {
                        const message = JSON.parse(result.messages);
    
                        message.HHmm = `${message.hour}:${message.min}`;
                        message.photoUrl = this.info.photoUrl;
                        message.isMyMessage = false;
                        message.photoUrl = this.memberMap[message.createdById]?.photoUrl;
                        message.name = this.memberMap[message.createdById]?.name;
                        message.isImg = true;
                        console.log('message: ', message);
    
                        this.contents.push(message);
                        this.newMessageNotification(`${message.name}님이 파일을 공유했습니다.`);
                        setTimeout(() => {
                            this.bodyScrollBottom();
                        }, 700);
                    }
                }
            } else if(Type__c == 'IN') {

            }
        });

        console.log(subResult);
        console.log('Subscription request sent to: ', JSON.stringify(subResult.channel));

        this.subscription = subResult;
    }

    registerErrorListener() {
        // Invoke onError empApi method
        onError((error) => {
            console.log('Received error from server: ', JSON.stringify(error));
            // Error contains the server-side error
        });
    }

    disconnectEvent() {
        // Invoke unsubscribe method of empApi
        unsubscribe(this.subscription, (response) => {
            console.log('unsubscribe() response: ', JSON.stringify(response));
            // Response is true for successful unsubscribe
        });
    }
}