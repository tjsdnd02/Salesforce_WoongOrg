import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { NavigationMixin } from 'lightning/navigation';

import searchUsers from '@salesforce/apex/createNewChattingGroupController.searchUsers';
import createChat from '@salesforce/apex/createNewChattingGroupController.createChat';

export default class CreateNewChattingGroup extends NavigationMixin(LightningElement) {
    @track isShowPassword = false;
    @track isSearching = false;
    @track isNoResults = false;
    @track users = [];
    @track selectUsers = [];
    @track searchText = '';

    handleTogglePrivate(e) {
        this.isShowPassword = e.currentTarget.checked;
    }

    handleSearchValue(e) {
        this.searchText = e.currentTarget.value;
    }

    async handleKeyup(e) {
        if(e.key == 'Enter') {
            const dropdownBox = this.template.querySelector('.user-dropdown');
            dropdownBox.classList.add('slds-is-open');

            this.isSearching = true;
            this.searchText = e.currentTarget.value;

            const result = await searchUsers({searchText: this.searchText});
            
            if(result.state == 'SUCCESS') {
                this.isNoResults = !result.users || result.users.length < 1;
                this.users = result.users;
            } else {
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: '사용자 검색을 실패하였습니다.'
                        , message: result.message
                        , variant: "error"
                    })
                );
            }
            this.isSearching = false;
        }
    }

    handleClickSearchInput(e) {
        if(this.users.length > 0) this.openDropdown(e.target.parentElement);
    }

    handleSearchFocus(e) {
        if(this.users.length > 0) this.openDropdown(e.target.parentElement);
    }

    handleMouseover(e) {
        if(this.users.length > 0) this.openDropdown(e.target.parentElement);
    }

    handleMouseleave(e) {
        this.closeDropdown(e.target);
    }

    handleSelectItem(e) {
        const targetId = e.currentTarget.dataset.recordid;
        const hasSelectedItem = this.selectUsers.filter((v) => {return v.key == targetId});

        if(hasSelectedItem.length > 0) return;

        const selectItem = this.users.filter((v,idx) => {return v.recordId == targetId})[0];
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

    handleClose() {
        this[NavigationMixin.Navigate]({
            type: 'standard__objectPage',
            attributes: {
                objectApiName: 'ChattingGroup__c',
                actionName: 'home'
            }
        });
    }

    async handleSave() {
        const inputs = this.template.querySelectorAll('lightning-input');
        let isPass = true;

        for(let i=0 ; i<inputs.length ; i++) {
            const e = inputs[i];
            if(e.type == 'checkbox') continue;
            if(e.required && !e.value) {
                e.classList.add('slds-has-error');
                isPass = false;
            } else {
                e.classList.remove('slds-has-error');
            }
        }
        
        if(!isPass) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: '채팅방을 만들지 못했습니다.'
                    , message: '필수 값을 입력해주세요.'
                    , variant: "error"
                })
            );
            return;
        }

        const submitData = {};

        inputs.forEach(e => {
            if(e.name != 'none') {
                submitData[e.name] = e.type != 'checkbox' ? e.value : e.checked;
            }
        });

        const memberIds = [];
        this.selectUsers.forEach(e => {
            memberIds.push(e.key);
        });

        submitData.members = memberIds.join(';');

        try {
            const result = await createChat({submitData});
            if(result.state == 'SUCCESS') {
                location.href = `/${result.recordId}`;
            } else {
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: '채팅방을 만들지 못했습니다.'
                        , message: result.message
                        , variant: "error"
                    })
                );
            }
        } catch (error) {
            console.error(error);
        }
    }

    closeDropdown(e) {
        try {
            e.classList.remove('slds-is-open');
        } catch (error) {
            console.error(error);
        }
    }

    openDropdown(e) {
        try {
            e.classList.add('slds-is-open');
        } catch (error) {
            console.error(error);
        }
    }
}