package com.beacon.hr.tests;

import com.beacon.hr.helpers.DriverFactory;
import com.beacon.hr.pages.EmployeesPage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class EmployeesTest {

    private EmployeesPage employees;

    @BeforeEach
    void setUp() {
        employees = new EmployeesPage();
        employees.open();
    }

    @AfterEach
    void tearDown() {
        DriverFactory.dispose();
    }

    @Test
    void searchFiltersTheEmployeeGrid() throws InterruptedException {
        employees.search("Jane");
        assertTrue(employees.rowCount() >= 1);
        assertTrue(employees.firstRowName().toLowerCase().contains("jane"));
    }

    @Test
    void invitingNewEmployeeShowsConfirmationToast() throws InterruptedException {
        employees.openInviteModal();
        employees.inviteEmail("new.hire@beacon.test");
        assertEquals("Invitation sent", employees.inviteToastText());
    }
}
