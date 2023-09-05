import { LightningElement, track, api } from 'lwc';
import LightningModal from "lightning/modal";

export default class MemberCheckModal extends LightningModal {
    @api info = {};

    @track isLoading = false;
    @track isPriview = false;
    @track isCheckPw = false;
    @track isPrivate;
    @track members;
    @track userId;
    @track password;
    @track pw = '';
    @track progressValue = 0;

    get headerMessage() {
        return this.isPrivate ? '비밀 채팅방에 접속하셨습니다. 비밀번호를 확인합니다.' : '현재 사용자가 채팅방 참가자 명단에 있는지 확인중입니다.';
    }

    get checkPasswordResultMessage() {
        return this.isCheckPw ? '비밀번호를 확인하였습니다.' : '';
    }

    connectedCallback() {
        const { isPrivate, members, userId, password } = this.info;
        this.isPrivate = isPrivate;
        this.members = members;
        this.userId = userId;
        this.password = password;
        if(!isPrivate) this.checkHasMember();
    }

    handlePasswordView() {
        this.isPriview = true;
    }

    handlePasswordHide() {
        this.isPriview = false;
    }

    handlePasswordKeyup(e) {
        const value = e.currentTarget.value;
        this.pw = value;
        if(e.key == 'Enter') {
            this.isLoading = true;
            const message = this.template.querySelector('.alert-message');
            const passwordInput = this.template.querySelector('.password-input');
            if(value == this.password) {
                message.innerText = '';
                passwordInput.classList.remove('slds-has-error');
                this.isPrivate = false;
                this.isCheckPw = true;
                this.checkHasMember();
            } else {
                message.innerText = '비밀번호가 일치하지 않습니다. 다시 입력해주세요.';
                passwordInput.classList.add('slds-has-error');
            }
            this.isLoading = false;
        }
    }

    checkHasMember() {
        const max = 100;
        const total = this.members.length;
        const split = max / total;
        let progress = 0;
        let isPass = false;
        for(let i=0 ; i<total ; i++) {
            const memberInfo = this.members[i];
            isPass = isPass ? isPass : memberInfo.recordId == this.userId;
            progress += split;
            this.progressValue = Math.ceil(progress);
        }
        setTimeout(() => {
            this.close(isPass ? 'SUCCESS' : 'NO_MEMBER');
        }, 1500);
    }

}