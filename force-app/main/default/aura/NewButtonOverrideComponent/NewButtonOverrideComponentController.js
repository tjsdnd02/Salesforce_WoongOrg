({
    doInit : function(component, event, helper) {
        const pageRef = component.get("v.pageReference");
        console.log('pageRef: ', pageRef);
    },

    rerender : function(component, event, helper) {
        // 간혹 refresh 안되는 경우가 있어 강제로 disconnected
        component.find("webCmp").disconnectedCallback();
        $A.get('e.force:refreshView').fire();
    }
})